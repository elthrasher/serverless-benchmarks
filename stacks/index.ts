#!/usr/bin/env node
import 'source-map-support/register';

import * as cdk from 'aws-cdk-lib';

import Csv2DDBStack from './csv2ddb-stack';
import ServerlessBenchmarksStack from './serverless-benchmarks-stack';


export default function main(app) {

  const csvDdbStack = new Csv2DDBStack(app, 'Csv2DDBStack');

  new ServerlessBenchmarksStack(app, 'ServerlessBenchmarksStack', {
    functions: csvDdbStack.functions,
  });

}
