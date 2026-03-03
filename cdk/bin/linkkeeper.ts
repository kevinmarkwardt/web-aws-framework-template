#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { LinkKeeperStack } from '../lib/linkkeeper-stack';

const app = new cdk.App();

new LinkKeeperStack(app, 'LinkKeeperStack', {
  env: {
    account: '177913614409',
    region: 'us-east-1',
  },
  domainName: 'linkkeeper.co',
});
