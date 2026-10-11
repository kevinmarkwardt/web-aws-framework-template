#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { YourAppStack, Stage } from '../lib/yourapp-stack';

const app = new cdk.App();

// One stack per stage, chosen with -c stage=prod|test (default prod):
//   prod  YourAppStack      yourapp.com (+ www., manager.)       original resource names
//   test  YourAppTestStack  test.yourapp.com (+ manager.test.)   -test names, on demand, DESTROY, noindex
const stage = String(app.node.tryGetContext('stage') ?? 'prod') as Stage;
if (stage !== 'prod' && stage !== 'test') {
  throw new Error(`-c stage must be prod or test, not "${stage}"`);
}

new YourAppStack(app, stage === 'prod' ? 'YourAppStack' : 'YourAppTestStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT || process.env.AWS_ACCOUNT_ID,
    region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
  },
  domainName: 'yourapp.com',
  stage,
});
