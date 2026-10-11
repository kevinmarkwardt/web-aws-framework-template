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
import { Construct } from 'constructs';

export type Stage = 'prod' | 'test';

export interface YourAppStackProps extends cdk.StackProps {
  /** The apex domain (its Route53 hosted zone must exist). Prod serves it; test serves test.<domain>. */
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
    // Admin host (same bundle, split by hostname in frontend/src/App.tsx). Phase 3 replaces it with admin.<domain>.
    const adminDomain = `manager.${siteDomain}`;
    const siteAliases = isProd ? [domainName, `www.${domainName}`, adminDomain] : [siteDomain, adminDomain];
    const disposable = isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY;
    // Runtime secrets, read by name; each stage's API can read only its own (yourapp/{stage}/*).
    const secretPrefix = `yourapp/${stage}`;

    // ========================================================================
    // Route53 Hosted Zone (lookup existing)
    // ========================================================================
    const hostedZone = route53.HostedZone.fromLookup(this, 'HostedZone', {
      domainName,
    });

    // ========================================================================
    // ACM Certificate (us-east-1 for CloudFront)
    // ========================================================================
    const certificate = new acm.Certificate(this, 'Certificate', {
      domainName: siteDomain,
      subjectAlternativeNames: siteAliases.filter((d) => d !== siteDomain),
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

    // ========================================================================
    // Cognito User Pool
    // ========================================================================
    const userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: `${prefix}-users`,
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
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

    // ========================================================================
    // S3 — SPA hosting bucket (rebuilt from the repo on every deploy)
    // ========================================================================
    const spaBucket = new s3.Bucket(this, 'SpaBucket', {
      bucketName: `${prefix}-spa-${this.account}`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    });

    // ========================================================================
    // SES Email Identity — the domain is one identity per account/region, so only the prod stack owns it; the test
    // stage sends from the same verified domain.
    // ========================================================================
    if (isProd) {
      new ses.EmailIdentity(this, 'SesIdentity', {
        identity: ses.Identity.publicHostedZone(hostedZone),
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

    // --- API Handler (main CRUD Lambda, exposed via Function URL) ---
    const apiHandler = new lambda.Function(this, 'ApiHandler', {
      ...lambdaDefaults,
      functionName: `${prefix}-api`,
      handler: 'handler.lambda_handler',
      code: lambdaAsset('api'),
      logGroup: makeLogGroup('api'),
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
        // Secrets are read at runtime by name; the values never live in code, env vars or the repo.
        STRIPE_SECRET_NAME: `${secretPrefix}/stripe`,
        ADMIN_SECRET_NAME: `${secretPrefix}/admin-credentials`,
        DAILY_JOB_FUNCTION: dailyJobFn.functionName,
        ...(isProd ? {} : { TEST_LOGIN: '1', TEST_LOGIN_SECRET_NAME: testLoginSecretName }),
      },
    });

    // Function URL for API handler (replaces API Gateway — saves $3.50/M requests)
    const apiUrl = apiHandler.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
      cors: {
        allowedOrigins: [`https://${siteDomain}`, `https://${adminDomain}`, 'http://localhost:5173'],
        allowedMethods: [lambda.HttpMethod.ALL],
        allowedHeaders: ['*'],
        allowCredentials: true,
      },
    });

    // NOTE: Stripe webhooks are handled by the API handler at /api/webhooks/stripe.

    // ========================================================================
    // IAM Permissions
    // ========================================================================

    // API handler — full CRUD on main table
    mainTable.grantReadWriteData(apiHandler);

    // Secrets of this stage only: Stripe keys (the admin Billing page can create/update them), admin credentials and
    // the test login key. Prod can't read yourapp/test/* and test can't read yourapp/prod/*.
    apiHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ['secretsmanager:GetSecretValue', 'secretsmanager:PutSecretValue', 'secretsmanager:CreateSecret'],
      resources: [`arn:aws:secretsmanager:${this.region}:${this.account}:secret:${secretPrefix}/*`],
    }));
    // Admin dashboard (Health page, actions)
    apiHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ['cloudwatch:GetMetricData'],
      resources: ['*'],
    }));
    apiHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ['lambda:InvokeFunction'],
      resources: [dailyJobFn.functionArn],
    }));
    apiHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ses:GetSendStatistics', 'ses:GetSendQuota'],
      resources: ['*'],
    }));
    apiHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ['dynamodb:DescribeTable'],
      resources: [mainTable.tableArn],
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

  // www redirect (skip for manager subdomain)
  if (host.startsWith('www.') && !host.startsWith('manager.')) {
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

    // Security headers on every response: HTTPS only (HSTS), no MIME sniffing, a referrer policy and no framing by other
    // sites. The test stage also stays out of search engines (X-Robots-Tag: noindex).
    const securityHeaders = new cloudfront.ResponseHeadersPolicy(this, 'SecurityHeaders', {
      responseHeadersPolicyName: `${prefix}-security`,
      securityHeadersBehavior: {
        strictTransportSecurity: { accessControlMaxAge: cdk.Duration.days(365), includeSubdomains: true, override: true },
        contentTypeOptions: { override: true },
        frameOptions: { frameOption: cloudfront.HeadersFrameOption.SAMEORIGIN, override: true },
        referrerPolicy: { referrerPolicy: cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN, override: true },
      },
      ...(isProd ? {} : {
        customHeadersBehavior: { customHeaders: [{ header: 'X-Robots-Tag', value: 'noindex, nofollow', override: true }] },
      }),
    });

    // /api/*: nothing is cached unless the API sends Cache-Control (default TTL 0). Authorization is part of the cache
    // key (a cache policy is the only way to forward it with caching enabled), so one user's response can never be
    // served to another. All query strings are in the key too.
    const apiCachePolicy = new cloudfront.CachePolicy(this, 'ApiCachePolicy', {
      cachePolicyName: `${prefix}-api`,
      defaultTtl: cdk.Duration.seconds(0),
      minTtl: cdk.Duration.seconds(0),
      maxTtl: cdk.Duration.minutes(10),
      headerBehavior: cloudfront.CacheHeaderBehavior.allowList('Authorization'),
      queryStringBehavior: cloudfront.CacheQueryStringBehavior.all(),
      cookieBehavior: cloudfront.CacheCookieBehavior.none(),
      enableAcceptEncodingGzip: true,
      enableAcceptEncodingBrotli: true,
    });

    // Parse the Function URL domain from the full URL
    const apiUrlDomain = cdk.Fn.select(2, cdk.Fn.split('/', apiUrl.url));

    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      domainNames: siteAliases,
      certificate,
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
    // Route53 DNS Records — one per site alias (prod: apex, www, manager; test: test., manager.test.)
    // ========================================================================
    siteAliases.forEach((recordName, i) => {
      const id = isProd ? ['ARecord', 'WwwARecord', 'ManagerARecord'][i] : ['TestARecord', 'TestManagerARecord'][i];
      new route53.ARecord(this, id, {
        zone: hostedZone,
        recordName,
        target: route53.RecordTarget.fromAlias(new route53targets.CloudFrontTarget(distribution)),
      });
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
    // CloudFormation Outputs (scripts/deploy.sh writes them to cdk-outputs-{stage}.json)
    // ========================================================================
    const output = (name: string, value: string, description: string) =>
      new cdk.CfnOutput(this, name, { value, description });
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
    output('AdminDomain', adminDomain, 'Admin site domain name');
    output('SecretPrefix', secretPrefix, 'Secrets Manager prefix this stage reads');
  }
}
