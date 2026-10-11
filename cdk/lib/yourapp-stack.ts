import * as fs from 'fs';
import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53targets from 'aws-cdk-lib/aws-route53-targets';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as ses from 'aws-cdk-lib/aws-ses';
import * as events from 'aws-cdk-lib/aws-events';
import * as eventsTargets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subs from 'aws-cdk-lib/aws-sns-subscriptions';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cwActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as budgets from 'aws-cdk-lib/aws-budgets';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import { Construct } from 'constructs';

export type Stage = 'prod' | 'test';

export interface YourAppStackProps extends cdk.StackProps {
  /** The apex domain (its Route53 hosted zone must exist). Prod serves it (+ www. and admin.); test serves
   *  test.<domain> and admin.test.<domain>. */
  domainName: string;
  stage: Stage;
}

export class YourAppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: YourAppStackProps) {
    super(scope, id, props);

    const { domainName, stage } = props;
    const isProd = stage === 'prod';
    // Prod keeps the original resource names (renaming would replace live resources); test gets its own copies with
    // a -test suffix, on-demand billing and DESTROY policies, so a test stack can be torn down and rebuilt freely.
    const prefix = isProd ? 'yourapp' : 'yourapp-test';
    const siteDomain = isProd ? domainName : `test.${domainName}`;
    // The admin site (admin/) is its own bucket, distribution and Lambda: admin.<domain> / admin.test.<domain>.
    const adminDomain = `admin.${siteDomain}`;
    const siteAliases = isProd ? [domainName, `www.${domainName}`] : [siteDomain];
    const disposable = isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY;
    // Runtime secrets, read by name; each stage's API can read only its own (yourapp/{stage}/*).
    const secretPrefix = `yourapp/${stage}`;
    // Billing modules (cdk.json context billingMode, or -c billingMode=...): none | subscriptions | credits | both.
    // The API reads it as BILLING_MODE; routes of a module that is off answer 404 (docs/payments.md).
    const billingMode = String(this.node.tryGetContext('billingMode') ?? 'both');
    if (!['none', 'subscriptions', 'credits', 'both'].includes(billingMode)) {
      throw new Error(`context billingMode must be none, subscriptions, credits or both, not "${billingMode}"`);
    }
    const creditsOn = billingMode === 'credits' || billingMode === 'both';
    // Where disputes, failed refunds and banned-card alerts go (api/lib/mail.py to_admin); empty = no admin email.
    const adminEmail = String(this.node.tryGetContext('adminEmail') ?? '');

    // ---- Ops and security switches (cdk.json context, or -c name=value; CLAUDE.md "Ops and security") ----
    const ctx = (name: string): unknown => this.node.tryGetContext(name);
    // true/false in cdk.json, or "1"/"0", "true"/"false" from -c
    const flag = (name: string, dflt: boolean): boolean => {
      const v = ctx(name);
      if (v === undefined || v === null || v === '') return dflt;
      return v === true || ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
    };
    const displayName = 'YourApp';  // the name in Cognito's emails and authenticator apps
    // Alarm and budget mail (prod): alarmEmail, else adminEmail; the address confirms the SNS subscription once.
    const alarmEmail = String(ctx('alarmEmail') ?? '') || adminEmail;
    const budgetUsd = Number(ctx('budgetUsd') ?? 50);
    if (!(budgetUsd > 0)) throw new Error(`context budgetUsd must be a positive number of USD, not "${ctx('budgetUsd')}"`);
    // Edge firewall (prod only: about $5/month per web ACL + $1/rule + $0.60 per million requests).
    const wafOn = isProd && flag('waf', false);
    // Admin site IP allowlist (CIDRs, or bare IPs): a separate web ACL on the admin distribution only; needs waf.
    const adminAllowIps = (Array.isArray(ctx('adminAllowIps')) ? (ctx('adminAllowIps') as unknown[]) : String(ctx('adminAllowIps') ?? '').split(','))
      .map((ip) => String(ip).trim()).filter(Boolean)
      .map((ip) => (ip.includes('/') ? ip : `${ip}/${ip.includes(':') ? 128 : 32}`));
    if (adminAllowIps.length && !wafOn) {
      cdk.Annotations.of(this).addWarningV2('yourapp:adminAllowIps', 'adminAllowIps is ignored: it needs "waf": true, and WAF is prod only');
    }
    // CLOUDFRONT-scope web ACLs exist only in us-east-1, so WAF needs this stack there (the CloudFront certificate already does).
    if (wafOn && !cdk.Token.isUnresolved(this.region) && this.region !== 'us-east-1') {
      throw new Error(`waf needs the stack in us-east-1 (CLOUDFRONT-scope web ACLs live there), not ${this.region}`);
    }
    // Cognito's sign-up / reset codes through SES from noreply@<domain> (needs SES production access: docs/launch-checklist.md)
    const cognitoSes = flag('cognitoSes', false);
    // Admins must have an authenticator app (api/lib/admins.py); default on in prod, off on test.
    const adminMfa = flag('adminMfa', isProd);
    // The user site's CSP: googleTags adds GA4 / AdSense origins (and inline scripts); csp = enforce | report-only | off.
    const googleTags = flag('googleTags', false);
    const cspMode = String(ctx('csp') ?? 'enforce');
    if (!['enforce', 'report-only', 'off'].includes(cspMode)) {
      throw new Error(`context csp must be enforce, report-only or off, not "${cspMode}"`);
    }

    // ========================================================================
    // Route53 Hosted Zone (lookup existing)
    // ========================================================================
    const hostedZone = route53.HostedZone.fromLookup(this, 'HostedZone', {
      domainName,
    });

    // ========================================================================
    // ACM Certificate (us-east-1 for CloudFront)
    // ========================================================================
    // One certificate for both distributions: the site's names and the admin host.
    const certificate = new acm.Certificate(this, 'Certificate', {
      domainName: siteDomain,
      subjectAlternativeNames: [...siteAliases.filter((d) => d !== siteDomain), adminDomain],
      validation: acm.CertificateValidation.fromDns(hostedZone),
    });

    // ========================================================================
    // DynamoDB — Single table design
    // Keys: USER#{id}|PROFILE, USER#{id}|ITEM#{id}, CONFIG|{name}
    // Prod: provisioned 25 RCU/WCU (free tier). Test: on demand (no idle cost).
    // ========================================================================
    const mainTable = new dynamodb.Table(this, 'MainTable', {
      tableName: prefix,
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      ...(isProd
        ? { billingMode: dynamodb.BillingMode.PROVISIONED, readCapacity: 25, writeCapacity: 25 }
        : { billingMode: dynamodb.BillingMode.PAY_PER_REQUEST }),
      removalPolicy: disposable,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: isProd },
    });

    // GSI: lookup user by stripeCustomerId (for webhook processing)
    mainTable.addGlobalSecondaryIndex({
      indexName: 'stripe-customer-index',
      partitionKey: { name: 'stripeCustomerId', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
      ...(isProd ? { readCapacity: 2, writeCapacity: 2 } : {}),
    });

    // GSI: list a record type across users, newest first (admin Users and Items tabs; api/lib/db.list_page), never a
    // table scan. KEYS_ONLY: only creating a profile or item writes it, later updates (balances, settings) never do.
    mainTable.addGlobalSecondaryIndex({
      indexName: 'list-index',
      partitionKey: { name: 'listPk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.KEYS_ONLY,
      ...(isProd ? { readCapacity: 2, writeCapacity: 2 } : {}),
    });

    // ========================================================================
    // Cognito User Pool
    // ========================================================================
    // Sign-up codes, password resets and email changes use userVerification (codes, branded); invitations are for users
    // created in the console. Cognito's own sender allows about 50 emails a day from no-reply@verificationemail.com:
    // cognitoSes=1 sends from noreply@<domain> through SES instead (SES production access first, or only verified
    // addresses get their codes). MFA: optional, authenticator apps (TOTP) only; required of admins by the admin API
    // (adminMfa), not by Cognito, so users never have to enroll.
    const userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: `${prefix}-users`,
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      userVerification: {
        emailSubject: `Your ${displayName} code`,
        emailBody: `Your ${displayName} code is {####}. If you didn't ask for it, you can ignore this email.`,
        emailStyle: cognito.VerificationEmailStyle.CODE,
      },
      userInvitation: {
        emailSubject: `Your ${displayName} account`,
        emailBody: `An account on ${displayName} (https://${siteDomain}) was made for you. Sign in as {username} with the temporary password {####} and choose your own.`,
      },
      ...(cognitoSes ? {
        email: cognito.UserPoolEmail.withSES({
          fromEmail: `noreply@${domainName}`,
          fromName: displayName,
          sesVerifiedDomain: domainName,
          sesRegion: this.region,
        }),
      } : {}),
      mfa: cognito.Mfa.OPTIONAL,
      mfaSecondFactor: { sms: false, otp: true },
      standardAttributes: {
        email: { required: true, mutable: true },
      },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: disposable,
    });

    const userPoolClient = userPool.addClient('WebClient', {
      userPoolClientName: `${prefix}-web`,
      authFlows: {
        userPassword: true,
        userSrp: true,
      },
      preventUserExistenceErrors: true,
    });

    // Admins: this group AND isAdmin on the profile, both re-checked by the admin Lambda on every request
    // (api/lib/admins.py). scripts/make-admin.py <stage> <email> [--revoke] sets both.
    new cognito.CfnUserPoolGroup(this, 'AdminsGroup', {
      userPoolId: userPool.userPoolId,
      groupName: 'admins',
      description: 'Admin site access (with isAdmin on the profile)',
    });

    // ========================================================================
    // S3 — SPA hosting bucket (rebuilt from the repo on every deploy)
    // ========================================================================
    const spaBucket = new s3.Bucket(this, 'SpaBucket', {
      bucketName: `${prefix}-spa-${this.account}`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    });

    // The admin site's own bucket (admin/ build): no admin code is ever served from the user site.
    const adminBucket = new s3.Bucket(this, 'AdminSiteBucket', {
      bucketName: `${prefix}-admin-${this.account}`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    });

    // ========================================================================
    // SES Email Identity — the domain is one identity per account/region, so only the prod stack owns it; the test
    // stage sends from the same verified domain.
    // ========================================================================
    // Every send from the domain uses the configuration set by default (no code change): addresses that bounce or
    // complain are suppressed, and each bounce / complaint is posted to the alert topic (prod monitoring, below). MAIL
    // FROM bounce.<domain> (its MX and SPF records come with the identity) aligns SPF for DMARC; DKIM already aligns.
    const sesConfig = isProd ? new ses.ConfigurationSet(this, 'SesConfig', {
      configurationSetName: `${prefix}-transactional`,
      reputationMetrics: true,
      suppressionReasons: ses.SuppressionReasons.BOUNCES_AND_COMPLAINTS,
    }) : undefined;
    if (isProd) {
      new ses.EmailIdentity(this, 'SesIdentity', {
        identity: ses.Identity.publicHostedZone(hostedZone),
        configurationSet: sesConfig,
        mailFromDomain: `bounce.${domainName}`,
      });
    }

    // ========================================================================
    // Lambda Functions — Python 3.12, ARM64
    // Code comes from build/ (scripts/bundle-lambdas.sh: source + Linux ARM64 wheels), never from the source folders.
    // ========================================================================
    const lambdaAsset = (name: string) => {
      const dir = path.join(__dirname, '../../build', name);
      if (!fs.existsSync(dir)) {
        throw new Error(`${dir} is missing: run scripts/bundle-lambdas.sh first (scripts/deploy.sh does it for you)`);
      }
      return lambda.Code.fromAsset(dir);
    };

    const lambdaDefaults = {
      runtime: lambda.Runtime.PYTHON_3_12,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 128,
      timeout: cdk.Duration.seconds(30),
    };

    // Shared log group settings — 30-day retention
    const makeLogGroup = (name: string) => new logs.LogGroup(this, `${name}Logs`, {
      logGroupName: `/aws/lambda/${prefix}-${name}`,
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // ========================================================================
    // daily-job Lambda — Example scheduled worker (replace with your logic)
    // ========================================================================
    const dailyJobFn = new lambda.Function(this, 'DailyJobFunction', {
      ...lambdaDefaults,
      functionName: `${prefix}-daily-job`,
      handler: 'handler.handler',
      code: lambdaAsset('daily-job'),
      timeout: cdk.Duration.minutes(5),
      memorySize: 256,
      logGroup: makeLogGroup('daily-job'),
      environment: {
        TABLE_NAME: mainTable.tableName,
        FROM_EMAIL: `noreply@${domainName}`,
        STAGE: stage,
        // Empty unless cdk.json context "bedrockModelId" names a current model / inference profile (lambdas/daily-job)
        BEDROCK_MODEL_ID: String(this.node.tryGetContext('bedrockModelId') ?? ''),
      },
    });

    mainTable.grantReadWriteData(dailyJobFn);

    dailyJobFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ses:SendEmail'],
      resources: ['*'],
    }));

    dailyJobFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['bedrock:InvokeModel'],
      resources: ['*'],
    }));

    // --- Test stage only: signing key for username logins (api/lib/auth.py) ---
    const testLoginSecretName = `${secretPrefix}/test-login`;
    if (!isProd) {
      new secretsmanager.Secret(this, 'TestLoginKey', {
        secretName: testLoginSecretName,
        description: 'Test stage only: HS256 key for username-only test logins (POST /api/test-login)',
        generateSecretString: { passwordLength: 64, excludePunctuation: true },
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      });
    }

    // CloudFront sends this to the API as X-Origin-Verify, and the API refuses requests without it
    // (api/lib/params.from_cloudfront): the Function URL is public. The stack's own id, never in the repo.
    const originVerify = cdk.Fn.select(2, cdk.Fn.split('/', this.stackId));
    // The admin distribution sends its own value to the admin Lambda, so the user site's header can't open it.
    const adminOriginVerify = cdk.Fn.join('-', ['admin', originVerify]);

    // --- API Handler (main CRUD Lambda, exposed via Function URL) ---
    const apiLogs = makeLogGroup('api');  // also read by the webhook / payments-sweep alarms
    const apiHandler = new lambda.Function(this, 'ApiHandler', {
      ...lambdaDefaults,
      functionName: `${prefix}-api`,
      handler: 'handler.lambda_handler',
      code: lambdaAsset('api'),
      logGroup: apiLogs,
      environment: {
        STAGE: stage,
        TABLE_NAME: mainTable.tableName,
        USER_POOL_ID: userPool.userPoolId,
        USER_POOL_CLIENT_ID: userPoolClient.userPoolClientId,
        DOMAIN_NAME: domainName,
        SITE_DOMAIN: siteDomain,
        FRONTEND_URL: `https://${siteDomain}`,
        SES_FROM_EMAIL: `noreply@${domainName}`,
        ORIGIN_VERIFY: originVerify,
        BILLING_MODE: billingMode,
        ADMIN_EMAIL: adminEmail,
        // Secrets are read at runtime by name; the values never live in code, env vars or the repo.
        STRIPE_SECRET_NAME: `${secretPrefix}/stripe`,
        ...(isProd ? {} : { TEST_LOGIN: '1', TEST_LOGIN_SECRET_NAME: testLoginSecretName }),
      },
    });

    // Function URL for API handler (replaces API Gateway — saves $3.50/M requests)
    const apiUrl = apiHandler.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
      cors: {
        allowedOrigins: [`https://${siteDomain}`, 'http://localhost:5173'],
        allowedMethods: [lambda.HttpMethod.ALL],
        allowedHeaders: ['*'],
        allowCredentials: true,
      },
    });

    // NOTE: Stripe webhooks are handled by the API handler at /api/webhooks/stripe (api/routes/webhooks.py).

    // --- Admin API (api/admin_handler.py): the same code bundle, its own function, role and Function URL. Reached only
    // through the admin distribution (its own X-Origin-Verify); /api/admin/* on the user API answers 404. No test login.
    const adminHandler = new lambda.Function(this, 'AdminHandler', {
      ...lambdaDefaults,
      functionName: `${prefix}-admin`,
      handler: 'admin_handler.lambda_handler',
      code: lambdaAsset('api'),
      memorySize: 256,
      logGroup: makeLogGroup('admin'),
      environment: {
        STAGE: stage,
        TABLE_NAME: mainTable.tableName,
        USER_POOL_ID: userPool.userPoolId,
        USER_POOL_CLIENT_ID: userPoolClient.userPoolClientId,
        FRONTEND_URL: `https://${adminDomain}`,  // CORS: the admin site only
        SITE_URL: `https://${siteDomain}`,
        SES_FROM_EMAIL: `noreply@${domainName}`,
        ORIGIN_VERIFY: adminOriginVerify,
        BILLING_MODE: billingMode,
        ADMIN_EMAIL: adminEmail,
        STRIPE_SECRET_NAME: `${secretPrefix}/stripe`,
        // Health tab: this stage's resource names, never hardcoded in the code
        API_FUNCTION_NAME: apiHandler.functionName,
        DAILY_JOB_FUNCTION: dailyJobFn.functionName,
        // admins need an authenticator app (api/lib/admins.py; context adminMfa)
        ADMIN_MFA: adminMfa ? '1' : '0',
      },
    });
    const adminUrl = adminHandler.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
      cors: {
        allowedOrigins: [`https://${adminDomain}`, 'http://localhost:5174'],
        allowedMethods: [lambda.HttpMethod.ALL],
        allowedHeaders: ['*'],
        allowCredentials: true,
      },
    });

    // Card refunds Stripe hasn't confirmed yet (a refund request that died half way) are settled every 15 minutes by
    // payments.sweep_pending, not only when that customer next opens the wallet. The API recognises exactly this event
    // (handler._is_payments_sweep); a Function URL request can't produce its top-level keys. Credits modes only.
    if (creditsOn) {
      new events.Rule(this, 'PaymentsSweep', {
        ruleName: `${prefix}-payments-sweep`,
        schedule: events.Schedule.rate(cdk.Duration.minutes(15)),
        targets: [new eventsTargets.LambdaFunction(apiHandler, {
          event: events.RuleTargetInput.fromObject({
            source: events.EventField.source, 'detail-type': events.EventField.detailType, app_task: 'payments-sweep',
          }),
        })],
      });
    }

    // ========================================================================
    // IAM Permissions
    // ========================================================================

    // API handler — full CRUD on main table
    mainTable.grantReadWriteData(apiHandler);

    // Secrets of this stage only (the Stripe key, the test login key): prod can't read yourapp/test/* and test can't
    // read yourapp/prod/*. Read only: scripts/stripe-secret.sh writes them.
    apiHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ['secretsmanager:GetSecretValue'],
      resources: [`arn:aws:secretsmanager:${this.region}:${this.account}:secret:${secretPrefix}/*`],
    }));
    // Account and admin email (api/lib/mail.py), only as noreply@ the domain. Email-address identities stay in the list
    // because in the SES sandbox IAM also checks each (verified) recipient; the From condition still stops sending as
    // them. (ses:FromAddress is the bare address; the second form is a fallback for "Name <address>".)
    const sendMail = new iam.PolicyStatement({
      actions: ['ses:SendEmail'],
      resources: [
        `arn:aws:ses:${this.region}:${this.account}:identity/${domainName}`,
        `arn:aws:ses:${this.region}:${this.account}:identity/*@*`,
      ],
      conditions: { StringLike: { 'ses:FromAddress': [`noreply@${domainName}`, `*<noreply@${domainName}>`] } },
    });
    apiHandler.addToRolePolicy(sendMail);

    // Admin handler: only what the admin API needs.
    mainTable.grantReadWriteData(adminHandler);  // the table and its indexes (list-index)
    adminHandler.addToRolePolicy(sendMail);      // support replies, ban notices
    adminHandler.addToRolePolicy(new iam.PolicyStatement({
      // the Stripe key only (card refunds, subscription cancels on a ban), never the test login key
      actions: ['secretsmanager:GetSecretValue'],
      resources: [`arn:aws:secretsmanager:${this.region}:${this.account}:secret:${secretPrefix}/stripe-??????`],
    }));
    adminHandler.addToRolePolicy(new iam.PolicyStatement({
      // the live admin check, and granting / revoking admin from the Users tab (api/lib/admins.py)
      // AdminGetUser: the admin MFA check (UserMFASettingList)
      actions: ['cognito-idp:AdminListGroupsForUser', 'cognito-idp:AdminAddUserToGroup', 'cognito-idp:AdminRemoveUserFromGroup',
        'cognito-idp:ListUsers', 'cognito-idp:AdminGetUser'],
      resources: [userPool.userPoolArn],
    }));
    adminHandler.addToRolePolicy(new iam.PolicyStatement({  // Health tab
      actions: ['cloudwatch:GetMetricData', 'ses:GetSendStatistics', 'ses:GetSendQuota', 'ses:GetAccount'],
      resources: ['*'],
    }));
    adminHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ['dynamodb:DescribeTable'],
      resources: [mainTable.tableArn],
    }));
    adminHandler.addToRolePolicy(new iam.PolicyStatement({  // "Run the daily job" (Health tab)
      actions: ['lambda:InvokeFunction'],
      resources: [dailyJobFn.functionArn],
    }));

    // ========================================================================
    // CloudFront Distribution
    // ========================================================================

    // CloudFront Function: www redirect + SPA routing (combined — one function per event type). The SPA rewrite lives
    // here, not in distribution-wide error pages, which would also turn every API 403/404 into index.html with a 200.
    const viewerRequestFunction = new cloudfront.Function(this, 'ViewerRequestFunction', {
      functionName: `${prefix}-viewer-request`,
      code: cloudfront.FunctionCode.fromInline(`
function handler(event) {
  var request = event.request;
  var host = request.headers.host.value;

  // www redirect
  if (host.startsWith('www.')) {
    return {
      statusCode: 301,
      statusDescription: 'Moved Permanently',
      headers: {
        location: { value: 'https://${siteDomain}' + request.uri }
      }
    };
  }

  // SPA fallback: rewrite to /index.html if no file extension
  var uri = request.uri;
  if (!uri.includes('.')) {
    request.uri = '/index.html';
  }

  return request;
}
`),
      runtime: cloudfront.FunctionRuntime.JS_2_0,
    });

    // The admin site: SPA rewrite only (no www host)
    const adminViewerRequestFunction = new cloudfront.Function(this, 'AdminViewerRequestFunction', {
      functionName: `${prefix}-admin-viewer-request`,
      code: cloudfront.FunctionCode.fromInline(`
function handler(event) {
  var request = event.request;
  if (!request.uri.includes('.')) {
    request.uri = '/index.html';
  }
  return request;
}
`),
      runtime: cloudfront.FunctionRuntime.JS_2_0,
    });

    // Content-Security-Policy, per site. Both: scripts only from the site itself, the API on the same origin, Cognito
    // for sign-in, no plugins, no <base> tricks. The user site also allows Stripe.js (js.stripe.com, its frames and
    // api.stripe.com) and, with googleTags, GA4 + AdSense (their script, frame and beacon hosts, and inline scripts:
    // the gtag snippet is inline and its hash depends on the IDs, so 'unsafe-inline' is the price of Google tags).
    // The admin site allows nothing else and can never be framed. csp=report-only sends it as
    // Content-Security-Policy-Report-Only (violations show in the browser console), csp=off drops it.
    const cognitoOrigin = `https://cognito-idp.${this.region}.amazonaws.com`;
    const google = googleTags ? {
      script: ["'unsafe-inline'", 'https://www.googletagmanager.com', 'https://*.googlesyndication.com', 'https://*.google.com',
        'https://*.gstatic.com', 'https://*.doubleclick.net', 'https://*.googleadservices.com', 'https://*.adtrafficquality.google'],
      frame: ['https://*.googlesyndication.com', 'https://*.doubleclick.net', 'https://*.google.com', 'https://*.adtrafficquality.google'],
      connect: ['https://*.google-analytics.com', 'https://*.analytics.google.com', 'https://*.googletagmanager.com',
        'https://*.googlesyndication.com', 'https://*.doubleclick.net', 'https://*.google.com', 'https://*.adtrafficquality.google'],
    } : { script: [], frame: [], connect: [] };
    const csp = (directives: Record<string, string[]>) =>
      Object.entries(directives).map(([k, v]) => [k, ...v].join(' ')).join('; ');
    const siteCsp = csp({
      'default-src': ["'self'"],
      'script-src': ["'self'", 'https://js.stripe.com', ...google.script],
      'style-src': ["'self'", "'unsafe-inline'"],
      'img-src': ["'self'", 'data:', 'blob:', 'https:'],
      'font-src': ["'self'", 'data:'],
      'connect-src': ["'self'", cognitoOrigin, 'https://api.stripe.com', ...google.connect],
      'frame-src': ['https://js.stripe.com', 'https://hooks.stripe.com', ...google.frame],
      'object-src': ["'none'"],
      'base-uri': ["'self'"],
      'form-action': ["'self'"],
      'frame-ancestors': ["'self'"],
      'upgrade-insecure-requests': [],
    });
    const adminCsp = csp({
      'default-src': ["'self'"],
      'script-src': ["'self'"],
      'style-src': ["'self'", "'unsafe-inline'"],
      'img-src': ["'self'", 'data:', 'blob:'],
      'font-src': ["'self'", 'data:'],
      'connect-src': ["'self'", cognitoOrigin],
      'frame-src': ["'none'"],
      'object-src': ["'none'"],
      'base-uri': ["'self'"],
      'form-action': ["'self'"],
      'frame-ancestors': ["'none'"],
      'upgrade-insecure-requests': [],
    });
    const cspHeader = (policy: string) => ({
      enforce: { contentSecurityPolicy: { contentSecurityPolicy: policy, override: true } },
      'report-only': {},
      off: {},
    }[cspMode]);
    const cspReportOnly = (policy: string) =>
      cspMode === 'report-only' ? [{ header: 'Content-Security-Policy-Report-Only', value: policy, override: true }] : [];
    const noindex = [{ header: 'X-Robots-Tag', value: 'noindex, nofollow', override: true }];

    // Security headers on every response: HTTPS only (HSTS), no MIME sniffing, a referrer policy, no framing by other
    // sites and the CSP. The test stage also stays out of search engines (X-Robots-Tag: noindex).
    const siteCustomHeaders = [...cspReportOnly(siteCsp), ...(isProd ? [] : noindex)];
    const securityHeaders = new cloudfront.ResponseHeadersPolicy(this, 'SecurityHeaders', {
      responseHeadersPolicyName: `${prefix}-security`,
      securityHeadersBehavior: {
        strictTransportSecurity: { accessControlMaxAge: cdk.Duration.days(365), includeSubdomains: true, override: true },
        contentTypeOptions: { override: true },
        frameOptions: { frameOption: cloudfront.HeadersFrameOption.SAMEORIGIN, override: true },
        referrerPolicy: { referrerPolicy: cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN, override: true },
        ...cspHeader(siteCsp),
      },
      ...(siteCustomHeaders.length ? { customHeadersBehavior: { customHeaders: siteCustomHeaders } } : {}),
    });

    // The admin site: the same headers, a strict CSP, never framed, and never indexed on any stage.
    const adminSecurityHeaders = new cloudfront.ResponseHeadersPolicy(this, 'AdminSecurityHeaders', {
      responseHeadersPolicyName: `${prefix}-admin-security`,
      securityHeadersBehavior: {
        strictTransportSecurity: { accessControlMaxAge: cdk.Duration.days(365), includeSubdomains: true, override: true },
        contentTypeOptions: { override: true },
        frameOptions: { frameOption: cloudfront.HeadersFrameOption.DENY, override: true },
        referrerPolicy: { referrerPolicy: cloudfront.HeadersReferrerPolicy.SAME_ORIGIN, override: true },
        ...cspHeader(adminCsp),
      },
      customHeadersBehavior: { customHeaders: [...cspReportOnly(adminCsp), ...noindex] },
    });

    // /api/*: nothing is cached unless the API sends Cache-Control (default TTL 0). Authorization is part of the cache
    // key (a cache policy is the only way to forward it with caching enabled), so one user's response can never be
    // served to another. Query strings: only the ones the API reads are in the key (junk parameters can't split or bust
    // the cache); every parameter still reaches the API (the origin request policy forwards them all). Keep this list
    // in step with params.query / query_int / day in api/ (tests/test_edge_sync.py checks it).
    const API_CACHE_QUERY_KEYS = ['actor', 'cursor', 'day', 'days', 'failed', 'mine', 'page', 'pageSize', 'q', 'sort', 'status', 'target', 'user'];
    const apiCachePolicy = new cloudfront.CachePolicy(this, 'ApiCachePolicy', {
      cachePolicyName: `${prefix}-api`,
      defaultTtl: cdk.Duration.seconds(0),
      minTtl: cdk.Duration.seconds(0),
      maxTtl: cdk.Duration.minutes(10),
      headerBehavior: cloudfront.CacheHeaderBehavior.allowList('Authorization'),
      queryStringBehavior: cloudfront.CacheQueryStringBehavior.allowList(...API_CACHE_QUERY_KEYS),
      cookieBehavior: cloudfront.CacheCookieBehavior.none(),
      enableAcceptEncodingGzip: true,
      enableAcceptEncodingBrotli: true,
    });

    // Parse the Function URL domain from the full URL
    const apiUrlDomain = cdk.Fn.select(2, cdk.Fn.split('/', apiUrl.url));

    // ========================================================================
    // WAF (prod, "waf": true): one CLOUDFRONT-scope web ACL on both distributions (us-east-1 only; checked above).
    //   rate     per-IP limit over 5 minutes (wafRateLimit, default 1000), the Stripe webhook exempt
    //   common   AWS core rule set (the webhook exempt; bodies over 8 KB only counted, not blocked: support messages
    //            and admin config saves can be larger)
    //   bad-inputs, ip-reputation   AWS known-bad-inputs and Amazon IP reputation lists
    // adminAllowIps adds a second web ACL for the admin distribution only: the same rules after "allowlist", which
    // blocks every address outside the list.
    // ========================================================================
    const wafMetrics = (name: string) => ({ cloudWatchMetricsEnabled: true, metricName: name, sampledRequestsEnabled: true });
    const notWebhook = {
      notStatement: { statement: { byteMatchStatement: {
        searchString: '/api/webhooks/stripe', positionalConstraint: 'EXACTLY', fieldToMatch: { uriPath: {} },
        textTransformations: [{ priority: 0, type: 'NONE' }],
      } } },
    };
    const wafRateLimit = Number(ctx('wafRateLimit') ?? 1000);
    const managedRule = (name: string, priority: number, extra: Record<string, unknown> = {}): wafv2.CfnWebACL.RuleProperty => ({
      name: `${prefix}-${name}`, priority, overrideAction: { none: {} }, visibilityConfig: wafMetrics(`${prefix}-${name}`),
      statement: { managedRuleGroupStatement: { vendorName: 'AWS', name, ...extra } },
    });
    const edgeRules = (first: number): wafv2.CfnWebACL.RuleProperty[] => [
      {
        name: `${prefix}-rate`, priority: first, action: { block: {} }, visibilityConfig: wafMetrics(`${prefix}-rate`),
        statement: { rateBasedStatement: { limit: wafRateLimit, evaluationWindowSec: 300, aggregateKeyType: 'IP', scopeDownStatement: notWebhook } },
      },
      managedRule('AWSManagedRulesCommonRuleSet', first + 1, {
        scopeDownStatement: notWebhook,
        ruleActionOverrides: [{ name: 'SizeRestrictions_BODY', actionToUse: { count: {} } }],
      }),
      managedRule('AWSManagedRulesKnownBadInputsRuleSet', first + 2),
      managedRule('AWSManagedRulesAmazonIpReputationList', first + 3),
    ];
    const webAcl = wafOn ? new wafv2.CfnWebACL(this, 'WebAcl', {
      name: `${prefix}-edge`, scope: 'CLOUDFRONT', defaultAction: { allow: {} }, visibilityConfig: wafMetrics(`${prefix}-edge`),
      rules: edgeRules(0),
    }) : undefined;
    let adminWebAcl = webAcl;
    if (webAcl && adminAllowIps.length) {
      const ipSets = (['IPV4', 'IPV6'] as const).flatMap((version) => {
        const addresses = adminAllowIps.filter((ip) => ip.includes(':') === (version === 'IPV6'));
        return addresses.length ? [new wafv2.CfnIPSet(this, `AdminAllow${version}`, {
          name: `${prefix}-admin-allow-${version.toLowerCase()}`, scope: 'CLOUDFRONT', ipAddressVersion: version, addresses,
        })] : [];
      });
      const inList = ipSets.map((s) => ({ ipSetReferenceStatement: { arn: s.attrArn } }));
      adminWebAcl = new wafv2.CfnWebACL(this, 'AdminWebAcl', {
        name: `${prefix}-admin-edge`, scope: 'CLOUDFRONT', defaultAction: { allow: {} }, visibilityConfig: wafMetrics(`${prefix}-admin-edge`),
        rules: [
          {
            name: `${prefix}-admin-allowlist`, priority: 0, action: { block: {} }, visibilityConfig: wafMetrics(`${prefix}-admin-allowlist`),
            statement: { notStatement: { statement: inList.length > 1 ? { orStatement: { statements: inList } } : inList[0] } },
          },
          ...edgeRules(1),
        ],
      });
    }

    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      domainNames: siteAliases,
      certificate,
      webAclId: webAcl?.attrArn,
      defaultRootObject: 'index.html',
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,

      // Default behavior: S3 SPA
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(spaBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        responseHeadersPolicy: securityHeaders,
        functionAssociations: [
          {
            function: viewerRequestFunction,
            eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
          },
        ],
      },

      // /api/* behavior: Lambda Function URL (handles all API + webhook routes)
      additionalBehaviors: {
        '/api/*': {
          origin: new origins.HttpOrigin(apiUrlDomain, {
            protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
            customHeaders: { 'X-Origin-Verify': originVerify },
          }),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: apiCachePolicy,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          responseHeadersPolicy: securityHeaders,
        },
      },

      // No error pages (they would replace the API's JSON errors with index.html). These entries only stop CloudFront
      // from caching the error codes it caches by default (for 10 seconds): a 503 from maintenance mode must not
      // outlive it. (401, 409 and 429 are never cached.)
      errorResponses: [400, 403, 404, 405, 414, 416, 500, 501, 502, 503, 504].map((httpStatus) => ({
        httpStatus,
        ttl: cdk.Duration.seconds(0),
      })),
    });

    // ========================================================================
    // Admin site distribution (admin.<domain> / admin.test.<domain>): its own bucket, and /api/admin/* to the admin
    // Lambda with the admin X-Origin-Verify. Nothing else of the API is reachable through it.
    // ========================================================================
    const adminDistribution = new cloudfront.Distribution(this, 'AdminDistribution', {
      domainNames: [adminDomain],
      certificate,
      webAclId: adminWebAcl?.attrArn,
      defaultRootObject: 'index.html',
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      comment: `${prefix} admin site`,
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(adminBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        responseHeadersPolicy: adminSecurityHeaders,
        functionAssociations: [{ function: adminViewerRequestFunction, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST }],
      },
      additionalBehaviors: {
        '/api/admin/*': {
          origin: new origins.HttpOrigin(cdk.Fn.select(2, cdk.Fn.split('/', adminUrl.url)), {
            protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
            customHeaders: { 'X-Origin-Verify': adminOriginVerify },
          }),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: apiCachePolicy,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          responseHeadersPolicy: adminSecurityHeaders,
        },
      },
      // as on the site: no error pages, and error codes are never cached
      errorResponses: [400, 403, 404, 405, 414, 416, 500, 501, 502, 503, 504].map((httpStatus) => ({
        httpStatus,
        ttl: cdk.Duration.seconds(0),
      })),
    });

    // ========================================================================
    // Route53 DNS Records — the site's aliases (prod: apex, www; test: test.) and the admin host
    // ========================================================================
    siteAliases.forEach((recordName, i) => {
      const id = isProd ? ['ARecord', 'WwwARecord'][i] : 'TestARecord';
      new route53.ARecord(this, id, {
        zone: hostedZone,
        recordName,
        target: route53.RecordTarget.fromAlias(new route53targets.CloudFrontTarget(distribution)),
      });
    });
    new route53.ARecord(this, isProd ? 'AdminARecord' : 'TestAdminARecord', {
      zone: hostedZone,
      recordName: adminDomain,
      target: route53.RecordTarget.fromAlias(new route53targets.CloudFrontTarget(adminDistribution)),
    });

    // ========================================================================
    // EventBridge — Daily job schedule (8 AM UTC)
    // Change cron expression to match your needs
    // ========================================================================
    new events.Rule(this, 'DailyJobRule', {
      ruleName: `${prefix}-daily-job`,
      schedule: events.Schedule.cron({ minute: '0', hour: '8' }),
      targets: [new eventsTargets.LambdaFunction(dailyJobFn)],
    });

    // ========================================================================
    // Monitoring (prod only): alarms + the monthly budget, all to one SNS topic mailing alarmEmail (else adminEmail)
    // ========================================================================
    const alertTopic = isProd ? this.addProdMonitoring({
      prefix, alarmEmail, budgetUsd, billingMode, creditsOn, mainTable, apiHandler, adminHandler, dailyJobFn, apiLogs,
      distribution, adminDistribution, sesConfig: sesConfig!,
    }) : undefined;

    // ========================================================================
    // CloudFormation Outputs (scripts/deploy.sh writes them to cdk-outputs-{stage}.json)
    // ========================================================================
    const output = (name: string, value: string, description: string) =>
      new cdk.CfnOutput(this, name, { value, description });
    if (alertTopic) output('AlertTopicArn', alertTopic.topicArn, 'SNS topic for alarms and budget alerts (confirm the email subscription)');
    if (webAcl) output('WebAclArn', webAcl.attrArn, 'WAF web ACL on the site distribution');
    if (adminWebAcl && adminWebAcl !== webAcl) output('AdminWebAclArn', adminWebAcl.attrArn, 'WAF web ACL with the admin IP allowlist');
    output('AdminMfa', adminMfa ? 'required' : 'optional', 'Whether the admin API requires an authenticator app (context adminMfa)');
    output('Stage', stage, 'Deployment stage (prod | test)');
    output('UserPoolId', userPool.userPoolId, 'Cognito User Pool ID');
    output('UserPoolClientId', userPoolClient.userPoolClientId, 'Cognito User Pool Client ID');
    output('ApiUrl', apiUrl.url, 'Lambda Function URL for API (refuses requests without X-Origin-Verify)');
    output('ApiFunctionName', apiHandler.functionName, 'API Lambda name');
    output('DailyJobFunctionName', dailyJobFn.functionName, 'daily-job Lambda name');
    output('CloudFrontDomain', distribution.distributionDomainName, 'CloudFront Distribution domain name');
    output('CloudFrontDistributionId', distribution.distributionId, 'CloudFront Distribution ID (for cache invalidation)');
    output('SpaBucketName', spaBucket.bucketName, 'S3 bucket for SPA assets');
    output('TableName', mainTable.tableName, 'DynamoDB single-table name');
    output('DomainName', siteDomain, 'Site domain name');
    output('AdminUrl', `https://${adminDomain}`, 'Admin site URL');
    output('AdminBucket', adminBucket.bucketName, 'S3 bucket for the admin site');
    output('AdminDistributionId', adminDistribution.distributionId, 'Admin CloudFront Distribution ID (for cache invalidation)');
    output('AdminFunctionName', adminHandler.functionName, 'Admin API Lambda name');
    output('AdminApiUrl', adminUrl.url, 'Admin Lambda Function URL (refuses requests without the admin X-Origin-Verify)');
    output('SecretPrefix', secretPrefix, 'Secrets Manager prefix this stage reads');
    output('BillingMode', billingMode, 'Billing modules on (none | subscriptions | credits | both)');
  }

  /**
   * Prod only. One SNS topic (`<prefix>-alerts`) gets every alarm (ALARM and OK), the monthly budget's 80% / 100%
   * notices and each SES bounce / complaint; alarmEmail (else adminEmail) is subscribed and must confirm once.
   * Alarms read metrics only: about $0.10 a month per metric, nothing per request. Add your own with `alarm(...)`.
   */
  private addProdMonitoring(r: {
    prefix: string;
    alarmEmail: string;
    budgetUsd: number;
    billingMode: string;
    creditsOn: boolean;
    mainTable: dynamodb.Table;
    apiHandler: lambda.Function;
    adminHandler: lambda.Function;
    dailyJobFn: lambda.Function;
    apiLogs: logs.ILogGroup;
    distribution: cloudfront.Distribution;
    adminDistribution: cloudfront.Distribution;
    sesConfig: ses.ConfigurationSet;
  }): sns.Topic {
    const { prefix, mainTable, apiHandler, adminHandler, dailyJobFn } = r;
    const period = cdk.Duration.minutes(5);

    const alertTopic = new sns.Topic(this, 'AlertTopic', { topicName: `${prefix}-alerts`, displayName: `${prefix} alerts` });
    if (r.alarmEmail) {
      alertTopic.addSubscription(new subs.EmailSubscription(r.alarmEmail));
    } else {
      cdk.Annotations.of(this).addWarningV2('yourapp:alarmEmail',
        'No alarmEmail or adminEmail in cdk.json: alarms and budget alerts go to an SNS topic nobody is subscribed to');
    }
    const alertAction = new cwActions.SnsAction(alertTopic);
    const alarm = (id: string, description: string, metric: cloudwatch.IMetric, threshold: number, evaluationPeriods = 1) => {
      const a = new cloudwatch.Alarm(this, id, {
        alarmName: `${prefix}-${id.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()}`,
        alarmDescription: description, metric, threshold, evaluationPeriods,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });
      a.addAlarmAction(alertAction);
      a.addOkAction(alertAction);
      return a;
    };
    // log lines containing any of the terms, counted per 5 minutes
    const logCount = (id: string, metricName: string, ...terms: string[]) => new logs.MetricFilter(this, id, {
      logGroup: r.apiLogs, filterPattern: logs.FilterPattern.anyTerm(...terms),
      metricNamespace: 'YourApp', metricName: `${prefix}-${metricName}`, metricValue: '1', defaultValue: 0,
    }).metric({ period, statistic: 'Sum' });
    const urlMetric = (fn: lambda.Function, metricName: string) => new cloudwatch.Metric({
      namespace: 'AWS/Lambda', metricName, period, statistic: 'Sum',
      dimensionsMap: { FunctionName: fn.functionName, Resource: fn.functionName },
    });

    // ---- the two APIs (Function URLs): 5xx answers, slow p95, throttles, uncaught errors
    for (const [name, fn, n5xx, nErrors] of [['Api', apiHandler, 5, 5], ['AdminApi', adminHandler, 3, 3]] as const) {
      const label = name === 'Api' ? 'The user API' : 'The admin API';
      alarm(`${name}5xx`, `${label} answered ${n5xx} or more requests with a 5xx in 5 minutes (log group /aws/lambda/${fn.functionName}).`,
        urlMetric(fn, 'Url5xxCount'), n5xx);
      alarm(`${name}Slow`, `${label} is slow: p95 duration of 10 seconds or more for 15 minutes (the Lambda stops at 30 s).`,
        fn.metricDuration({ period, statistic: 'p95' }), 10_000, 3);
      alarm(`${name}Throttles`, `${label} Lambda was throttled: requests were turned away (account concurrency).`,
        fn.metricThrottles({ period, statistic: 'Sum' }), 1);
      alarm(`${name}Errors`, `${label} Lambda failed (uncaught) ${nErrors} or more times in 5 minutes${name === 'Api' ? ', the payments sweep included' : ''}.`,
        fn.metricErrors({ period, statistic: 'Sum' }), nErrors);
    }
    alarm('DailyJobErrors', `The daily job (${dailyJobFn.functionName}) failed.`, dailyJobFn.metricErrors({ period, statistic: 'Sum' }), 1);

    // ---- money: a webhook that failed (Stripe retries it, but a payment may not be recorded yet) and the refund sweep
    if (r.billingMode !== 'none') {
      alarm('StripeWebhookFailed', 'A Stripe webhook failed or was refused (WEBHOOK_FAILED / STRIPE_WEBHOOK_SECRET_MISSING in the API log). Check the admin Stripe log and Stripe.',
        logCount('WebhookFailures', 'webhook-failed', 'WEBHOOK_FAILED', 'STRIPE_WEBHOOK_SECRET_MISSING'), 1);
    }
    if (r.creditsOn) {
      alarm('PaymentsSweepFailed', 'The payments sweep failed (PAYMENTS_SWEEP_FAILED in the API log): card refunds may stay pending.',
        logCount('PaymentsSweepFailures', 'payments-sweep-failed', 'PAYMENTS_SWEEP_FAILED'), 1);
    }

    // ---- DynamoDB: throttled requests on the table or its indexes (prod is provisioned: raise capacity)
    const ddb = (metricName: string, index?: string) => new cloudwatch.Metric({
      namespace: 'AWS/DynamoDB', metricName, period, statistic: 'Sum',
      dimensionsMap: { TableName: mainTable.tableName, ...(index ? { GlobalSecondaryIndexName: index } : {}) },
    });
    const throttleMetrics: Record<string, cloudwatch.IMetric> = {};
    [undefined, 'stripe-customer-index', 'list-index'].forEach((index, i) => {
      throttleMetrics[`r${i}`] = ddb('ReadThrottleEvents', index);
      throttleMetrics[`w${i}`] = ddb('WriteThrottleEvents', index);
    });
    alarm('DatabaseThrottled', 'DynamoDB throttled requests (table or an index): writes or reads may have failed. Raise capacity or switch to on demand.',
      new cloudwatch.MathExpression({ expression: 'SUM(METRICS())', period, usingMetrics: throttleMetrics }), 1);

    // ---- email: SES reviews an account at a 5% bounce or 0.1% complaint rate and may pause all sending (account-wide)
    const sesRate = (metricName: string) => new cloudwatch.Metric({
      namespace: 'AWS/SES', metricName, period: cdk.Duration.hours(1), statistic: 'Maximum' });
    alarm('EmailBounceRate', 'SES bounce rate reached 5% (account-wide): check the bounce notices on this topic.', sesRate('Reputation.BounceRate'), 0.05);
    alarm('EmailComplaintRate', 'SES complaint rate reached 0.1% (account-wide): check the complaint notices on this topic.', sesRate('Reputation.ComplaintRate'), 0.001);
    r.sesConfig.addEventDestination('Feedback', {
      destination: ses.EventDestination.snsTopic(alertTopic),
      events: [ses.EmailSendingEvent.BOUNCE, ses.EmailSendingEvent.COMPLAINT],
    });

    // ---- CloudFront: share of 5xx responses, per distribution (metrics live in us-east-1, like this stack)
    alarm('Site5xxRate', 'The site\'s CloudFront served 5% or more 5xx responses for 10 minutes (site or API).',
      r.distribution.metric5xxErrorRate({ period, statistic: 'Average' }), 5, 2);
    alarm('AdminSite5xxRate', 'The admin site\'s CloudFront served 5% or more 5xx responses for 10 minutes.',
      r.adminDistribution.metric5xxErrorRate({ period, statistic: 'Average' }), 5, 2);

    // ---- spend: the whole account's monthly cost (budgets are account-wide; other projects in the account count too)
    alertTopic.addToResourcePolicy(new iam.PolicyStatement({
      actions: ['sns:Publish'],
      principals: [new iam.ServicePrincipal('budgets.amazonaws.com')],
      resources: [alertTopic.topicArn],
      conditions: { StringEquals: { 'aws:SourceAccount': this.account } },
    }));
    const notify = (notificationType: string, threshold: number) => ({
      notification: { notificationType, comparisonOperator: 'GREATER_THAN', threshold, thresholdType: 'PERCENTAGE' },
      subscribers: [{ subscriptionType: 'SNS', address: alertTopic.topicArn }],
    });
    const budget = new budgets.CfnBudget(this, 'MonthlyBudget', {
      budget: {
        budgetName: `${prefix}-monthly`, budgetType: 'COST', timeUnit: 'MONTHLY',
        budgetLimit: { amount: r.budgetUsd, unit: 'USD' },
      },
      notificationsWithSubscribers: [notify('ACTUAL', 80), notify('ACTUAL', 100), notify('FORECASTED', 100)],
    });
    budget.node.addDependency(alertTopic);  // the topic policy must let Budgets publish before the budget is made

    return alertTopic;
  }
}
