#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { YourAppStack } from '../lib/yourapp-stack';

const app = new cdk.App();

new YourAppStack(app, 'YourAppStack', {
  env: {
    account: 'YOUR_AWS_ACCOUNT_ID',
    region: 'us-east-1',
  },
  domainName: 'yourapp.com',
});
