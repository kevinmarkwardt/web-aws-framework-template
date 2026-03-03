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
import * as ses from 'aws-cdk-lib/aws-ses';
import * as events from 'aws-cdk-lib/aws-events';
import * as eventsTargets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

export interface YourAppStackProps extends cdk.StackProps {
  domainName: string;
}

export class YourAppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: YourAppStackProps) {
    super(scope, id, props);

    const { domainName } = props;

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
      domainName,
      subjectAlternativeNames: [`www.${domainName}`, `manager.${domainName}`],
      validation: acm.CertificateValidation.fromDns(hostedZone),
    });

    // ========================================================================
    // DynamoDB — Single table design, provisioned mode (25 RCU/WCU free tier)
    // Backend uses pk/sk with prefixed keys: USER#, LINK#, PITCH#
    // ========================================================================
    const mainTable = new dynamodb.Table(this, 'MainTable', {
      tableName: 'yourapp',
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PROVISIONED,
      readCapacity: 25,
      writeCapacity: 25,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
    });

    // GSI: lookup user by email
    mainTable.addGlobalSecondaryIndex({
      indexName: 'email-index',
      partitionKey: { name: 'email', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
      readCapacity: 2,
      writeCapacity: 2,
    });

    // GSI: lookup user by stripeCustomerId (for webhook processing)
    mainTable.addGlobalSecondaryIndex({
      indexName: 'stripe-customer-index',
      partitionKey: { name: 'stripeCustomerId', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
      readCapacity: 2,
      writeCapacity: 2,
    });

    // ========================================================================
    // Cognito User Pool
    // ========================================================================
    const userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: 'yourapp-users',
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
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const userPoolClient = userPool.addClient('WebClient', {
      userPoolClientName: 'yourapp-web',
      authFlows: {
        userPassword: true,
        userSrp: true,
      },
      preventUserExistenceErrors: true,
    });

    // ========================================================================
    // S3 Buckets
    // ========================================================================

    // SPA hosting bucket
    const spaBucket = new s3.Bucket(this, 'SpaBucket', {
      bucketName: `yourapp-spa-${this.account}`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    });

    // PDF report archive bucket
    const reportsBucket = new s3.Bucket(this, 'ReportsBucket', {
      bucketName: `yourapp-reports-${this.account}`,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      lifecycleRules: [
        {
          transitions: [
            {
              storageClass: s3.StorageClass.INFREQUENT_ACCESS,
              transitionAfter: cdk.Duration.days(90),
            },
          ],
        },
      ],
    });

    // ========================================================================
    // SES Email Identity
    // ========================================================================
    const sesIdentity = new ses.EmailIdentity(this, 'SesIdentity', {
      identity: ses.Identity.publicHostedZone(hostedZone),
    });

    // ========================================================================
    // Lambda Functions — Python 3.12, ARM64, 128MB
    // ========================================================================
    const lambdaDefaults = {
      runtime: lambda.Runtime.PYTHON_3_12,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 128,
      timeout: cdk.Duration.seconds(30),
    };

    // Shared log group settings — 30-day retention
    const makeLogGroup = (name: string) => new logs.LogGroup(this, `${name}Logs`, {
      logGroupName: `/aws/lambda/yourapp-${name}`,
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Shared environment variables for all Lambdas
    const sharedEnv = {
      TABLE_NAME: mainTable.tableName,
      USER_POOL_ID: userPool.userPoolId,
      USER_POOL_CLIENT_ID: userPoolClient.userPoolClientId,
      REPORTS_BUCKET: reportsBucket.bucketName,
      DOMAIN_NAME: domainName,
      FRONTEND_URL: `https://${domainName}`,
      SES_FROM_EMAIL: `noreply@${domainName}`,
    };

    // --- API Handler (main CRUD Lambda, exposed via Function URL) ---
    const apiHandler = new lambda.Function(this, 'ApiHandler', {
      ...lambdaDefaults,
      functionName: 'yourapp-api',
      handler: 'handler.lambda_handler',
      code: lambda.Code.fromAsset('../api'),
      logGroup: makeLogGroup('api'),
      timeout: cdk.Duration.seconds(30),
      environment: {
        ...sharedEnv,
      },
    });

    // Function URL for API handler (replaces API Gateway — saves $3.50/M requests)
    const apiUrl = apiHandler.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
      cors: {
        allowedOrigins: [`https://${domainName}`, 'http://localhost:5173'],
        allowedMethods: [lambda.HttpMethod.ALL],
        allowedHeaders: ['*'],
        allowCredentials: true,
      },
    });

    // --- Link Crawler ---
    const linkCrawler = new lambda.Function(this, 'LinkCrawler', {
      ...lambdaDefaults,
      functionName: 'yourapp-crawler',
      handler: 'handler.lambda_handler',
      code: lambda.Code.fromAsset('../lambdas/crawler'),
      logGroup: makeLogGroup('crawler'),
      timeout: cdk.Duration.minutes(5),
      memorySize: 256,
      environment: {
        ...sharedEnv,
        ALERTS_FUNCTION: 'yourapp-alerts',
      },
    });

    // --- Alert Sender ---
    const alertSender = new lambda.Function(this, 'AlertSender', {
      ...lambdaDefaults,
      functionName: 'yourapp-alerts',
      handler: 'handler.lambda_handler',
      code: lambda.Code.fromAsset('../lambdas/alerts'),
      logGroup: makeLogGroup('alerts'),
      environment: {
        ...sharedEnv,
        IMPACT_SCORER_FUNCTION: 'yourapp-impact-scorer',
      },
    });

    // --- Digest Sender (weekly Monday digest) ---
    const digestSender = new lambda.Function(this, 'DigestSender', {
      ...lambdaDefaults,
      functionName: 'yourapp-digest',
      handler: 'handler.lambda_handler',
      code: lambda.Code.fromAsset('../lambdas/digest'),
      logGroup: makeLogGroup('digest'),
      timeout: cdk.Duration.minutes(5),
      environment: {
        ...sharedEnv,
      },
    });

    // --- Reminder Sender (pipeline follow-up reminders) ---
    const reminderSender = new lambda.Function(this, 'ReminderSender', {
      ...lambdaDefaults,
      functionName: 'yourapp-reminders',
      handler: 'handler.lambda_handler',
      code: lambda.Code.fromAsset('../lambdas/reminders'),
      logGroup: makeLogGroup('reminders'),
      environment: {
        ...sharedEnv,
      },
    });

    // --- Impact Scorer (Pro -- Bedrock Haiku enrichment) ---
    const impactScorer = new lambda.Function(this, 'ImpactScorer', {
      ...lambdaDefaults,
      functionName: 'yourapp-impact-scorer',
      handler: 'handler.lambda_handler',
      code: lambda.Code.fromAsset('../lambdas/impact-scorer'),
      logGroup: makeLogGroup('impact-scorer'),
      timeout: cdk.Duration.seconds(60),
      environment: {
        ...sharedEnv,
        BEDROCK_MODEL_ID: 'anthropic.claude-3-5-haiku-20241022-v1:0',
      },
    });

    // --- Report Generator (Pro -- monthly PDF) ---
    const reportGenerator = new lambda.Function(this, 'ReportGenerator', {
      ...lambdaDefaults,
      functionName: 'yourapp-report-generator',
      handler: 'handler.lambda_handler',
      code: lambda.Code.fromAsset('../lambdas/report-generator'),
      logGroup: makeLogGroup('report-generator'),
      timeout: cdk.Duration.minutes(5),
      memorySize: 512,
      environment: {
        ...sharedEnv,
        BEDROCK_MODEL_ID: 'anthropic.claude-3-5-haiku-20241022-v1:0',
      },
    });

    // NOTE: Stripe webhooks are handled by the API handler at /api/webhooks/stripe.
    // No separate stripe-webhook Lambda needed — billing.handle_webhook() handles
    // signature verification and plan updates directly.

    // ========================================================================
    // IAM Permissions
    // ========================================================================

    // API handler — full CRUD on main table + Cognito admin + invoke crawler
    mainTable.grantReadWriteData(apiHandler);
    apiHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ['cognito-idp:AdminGetUser'],
      resources: [userPool.userPoolArn],
    }));
    linkCrawler.grantInvoke(apiHandler); // for on-demand crawl

    // Admin dashboard permissions
    apiHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ['secretsmanager:GetSecretValue', 'secretsmanager:PutSecretValue', 'secretsmanager:CreateSecret'],
      resources: [`arn:aws:secretsmanager:${this.region}:${this.account}:secret:yourapp/*`],
    }));
    apiHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ['cloudwatch:GetMetricData', 'cloudwatch:GetMetricStatistics', 'cloudwatch:ListMetrics'],
      resources: ['*'],
    }));
    apiHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ['lambda:ListFunctions', 'lambda:GetFunction', 'lambda:InvokeFunction'],
      resources: [`arn:aws:lambda:${this.region}:${this.account}:function:yourapp-*`],
    }));
    apiHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ses:GetSendStatistics', 'ses:GetSendQuota'],
      resources: ['*'],
    }));
    apiHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ['events:ListRules', 'events:DescribeRule'],
      resources: [`arn:aws:events:${this.region}:${this.account}:rule/yourapp-*`],
    }));
    apiHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ['dynamodb:DescribeTable'],
      resources: [mainTable.tableArn],
    }));

    // Link crawler — read/write main table (read users, write link status), invoke alert sender
    mainTable.grantReadWriteData(linkCrawler);
    alertSender.grantInvoke(linkCrawler);

    // Alert sender — read/write main table (read users+links, write lastAlertSent), send SES, invoke impact scorer
    mainTable.grantReadWriteData(alertSender);
    alertSender.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ses:SendEmail', 'ses:SendRawEmail'],
      resources: ['*'],
    }));
    impactScorer.grantInvoke(alertSender);

    // Digest sender — read main table, send SES
    mainTable.grantReadData(digestSender);
    digestSender.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ses:SendEmail', 'ses:SendRawEmail'],
      resources: ['*'],
    }));

    // Reminder sender — read/write main table (read users+pitches, write lastReminderSent), send SES
    mainTable.grantReadWriteData(reminderSender);
    reminderSender.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ses:SendEmail', 'ses:SendRawEmail'],
      resources: ['*'],
    }));

    // Impact scorer — read main table, invoke Bedrock, send SES
    mainTable.grantReadData(impactScorer);
    impactScorer.addToRolePolicy(new iam.PolicyStatement({
      actions: ['bedrock:InvokeModel'],
      resources: ['*'],
    }));
    impactScorer.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ses:SendEmail', 'ses:SendRawEmail'],
      resources: ['*'],
    }));

    // Report generator — read main table, write reports bucket, send SES, invoke Bedrock
    mainTable.grantReadData(reportGenerator);
    reportsBucket.grantReadWrite(reportGenerator);
    reportGenerator.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ses:SendEmail', 'ses:SendRawEmail'],
      resources: ['*'],
    }));
    reportGenerator.addToRolePolicy(new iam.PolicyStatement({
      actions: ['bedrock:InvokeModel'],
      resources: ['*'],
    }));

    // Stripe webhooks are handled by apiHandler — already has read/write access.

    // ========================================================================
    // CloudFront Distribution
    // ========================================================================

    // CloudFront Function: www redirect + SPA routing (combined — one function per event type)
    const viewerRequestFunction = new cloudfront.Function(this, 'ViewerRequestFunction', {
      functionName: 'yourapp-viewer-request',
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
        location: { value: 'https://${domainName}' + request.uri }
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

    // Parse the Function URL domain from the full URL
    const apiUrlDomain = cdk.Fn.select(2, cdk.Fn.split('/', apiUrl.url));

    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      domainNames: [domainName, `www.${domainName}`, `manager.${domainName}`],
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
          }),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        },
      },

      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.seconds(0),
        },
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.seconds(0),
        },
      ],
    });

    // ========================================================================
    // Route53 DNS Records
    // ========================================================================
    new route53.ARecord(this, 'ARecord', {
      zone: hostedZone,
      recordName: domainName,
      target: route53.RecordTarget.fromAlias(
        new route53targets.CloudFrontTarget(distribution)
      ),
    });

    new route53.ARecord(this, 'WwwARecord', {
      zone: hostedZone,
      recordName: `www.${domainName}`,
      target: route53.RecordTarget.fromAlias(
        new route53targets.CloudFrontTarget(distribution)
      ),
    });

    new route53.ARecord(this, 'ManagerARecord', {
      zone: hostedZone,
      recordName: `manager.${domainName}`,
      target: route53.RecordTarget.fromAlias(
        new route53targets.CloudFrontTarget(distribution)
      ),
    });

    // ========================================================================
    // EventBridge Schedules
    // ========================================================================

    // Daily crawl — 11 PM ET (4 AM UTC next day) for Free/Starter links
    new events.Rule(this, 'DailyCrawlRule', {
      ruleName: 'yourapp-daily-crawl',
      schedule: events.Schedule.cron({ minute: '0', hour: '4' }), // 11 PM ET = 4 AM UTC
      targets: [new eventsTargets.LambdaFunction(linkCrawler, {
        event: events.RuleTargetInput.fromObject({ tier: 'daily' }),
      })],
    });

    // Hourly crawl — every hour for Pro links
    new events.Rule(this, 'HourlyCrawlRule', {
      ruleName: 'yourapp-hourly-crawl',
      schedule: events.Schedule.rate(cdk.Duration.hours(1)),
      targets: [new eventsTargets.LambdaFunction(linkCrawler, {
        event: events.RuleTargetInput.fromObject({ tier: 'hourly' }),
      })],
    });

    // Monday digest — Monday 7 AM ET (12 PM UTC)
    new events.Rule(this, 'MondayDigestRule', {
      ruleName: 'yourapp-monday-digest',
      schedule: events.Schedule.cron({ minute: '0', hour: '12', weekDay: 'MON' }),
      targets: [new eventsTargets.LambdaFunction(digestSender)],
    });

    // Daily reminders — 8 AM ET (1 PM UTC)
    new events.Rule(this, 'DailyRemindersRule', {
      ruleName: 'yourapp-daily-reminders',
      schedule: events.Schedule.cron({ minute: '0', hour: '13' }), // 8 AM ET = 1 PM UTC
      targets: [new eventsTargets.LambdaFunction(reminderSender)],
    });

    // Monthly report — 1st of month, 6 AM ET (11 AM UTC)
    new events.Rule(this, 'MonthlyReportRule', {
      ruleName: 'yourapp-monthly-report',
      schedule: events.Schedule.cron({ minute: '0', hour: '11', day: '1' }),
      targets: [new eventsTargets.LambdaFunction(reportGenerator)],
    });

    // ========================================================================
    // CloudFormation Outputs
    // ========================================================================
    new cdk.CfnOutput(this, 'UserPoolId', {
      value: userPool.userPoolId,
      description: 'Cognito User Pool ID',
    });

    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: userPoolClient.userPoolClientId,
      description: 'Cognito User Pool Client ID',
    });

    new cdk.CfnOutput(this, 'ApiUrl', {
      value: apiUrl.url,
      description: 'Lambda Function URL for API',
    });

    new cdk.CfnOutput(this, 'CloudFrontDomain', {
      value: distribution.distributionDomainName,
      description: 'CloudFront Distribution domain name',
    });

    new cdk.CfnOutput(this, 'CloudFrontDistributionId', {
      value: distribution.distributionId,
      description: 'CloudFront Distribution ID (for cache invalidation)',
    });

    new cdk.CfnOutput(this, 'SpaBucketName', {
      value: spaBucket.bucketName,
      description: 'S3 bucket for SPA assets',
    });

    new cdk.CfnOutput(this, 'ReportsBucketName', {
      value: reportsBucket.bucketName,
      description: 'S3 bucket for PDF report archive',
    });

    new cdk.CfnOutput(this, 'TableName', {
      value: mainTable.tableName,
      description: 'DynamoDB single-table name',
    });

    new cdk.CfnOutput(this, 'DomainName', {
      value: domainName,
      description: 'Site domain name',
    });
  }
}
