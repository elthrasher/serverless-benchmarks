#!/usr/bin/env node
import 'source-map-support/register';

import * as cdk from 'aws-cdk-lib';

import { Csv2DDBStack } from '../src/csv2ddb-stack';
import { ServerlessBenchmarksStack } from '../src/serverless-benchmarks-stack';

const app = new cdk.App();

const csvDdbStack = new Csv2DDBStack(app, 'Csv2DDBStack');

new ServerlessBenchmarksStack(app, 'ServerlessBenchmarksStack', {
  functions: csvDdbStack.functions,
});
