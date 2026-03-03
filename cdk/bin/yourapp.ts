#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { YourAppStack } from '../lib/yourapp-stack';

const app = new cdk.App();

new YourAppStack(app, 'YourAppStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT || process.env.AWS_ACCOUNT_ID,
    region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
  },
  domainName: 'yourapp.com',
});
