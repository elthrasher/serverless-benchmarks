import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { GetFunctionCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { EventBridgeEvent, EventBridgeHandler } from 'aws-lambda';
import { get } from 'https';
import { HttpApis } from '../src/csv2ddb-stack';

import { getStats } from './util';

const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});
const lambdaClient = new LambdaClient({});

const tableName = process.env.TABLE_NAME;
const iterations = 100;

// the first section should be the cold starts
const iterationSplits = 2;

export interface CloudWatchStats {
  duration: number;
  logGroupName: string;
  logStreamName: string;
  requestId: string;
  startTime: number;
  endTime: number;
}

// original from https://bobbyhadz.com/blog/aws-lambda-http-request-nodejs
const getRequest = (url: string): Promise<CloudWatchStats> => {
  const startTime = new Date().getTime();

  return new Promise((resolve, reject) => {
    const req = get(url, (res) => {
      let rawData = '';
      res.on('data', (chunk) => {
        rawData += chunk;
      });
      res.on('end', () => {
        const endTime = new Date().getTime();
        const data = JSON.parse(rawData);
        resolve({
          duration: endTime - startTime,
          logGroupName: data['context']['logGroupName'],
          logStreamName: data['context']['logStreamName'],
          requestId: data['context']['awsRequestId'],
          startTime: startTime,
          endTime: endTime,
        });
      });
    });
    req.on('error', (err: string | undefined) => {
      reject(new Error(err));
    });
  });
};

export const handler = async (event: EventBridgeEvent<string, string>) => {
  // Determine the set of APIs to test based on the rule that triggered this invocation
  const target = event.resources[0].split('/').pop();
  let fns: HttpApis[] | undefined = undefined;
  switch (target) {
    case 'LambdaBenchmarkRuleA':
      fns = JSON.parse(process.env.JSON_STRINGIFIED_TARGETS_A || '');
      break;
    case 'LambdaBenchmarkRuleB':
      fns = JSON.parse(process.env.JSON_STRINGIFIED_TARGETS_B || '');
      break;
    case 'LambdaBenchmarkRuleC':
      fns = JSON.parse(process.env.JSON_STRINGIFIED_TARGETS_C || '');
      break;
    default:
      console.log('do not know what to do with:', target);
  }
  if (!fns) {
    throw new Error('Missing or incorrect env var!');
  }
  const date = new Date().toISOString().split('T')[0];

  const durations: { [key: string]: number[] } = {};
  const cwLookupInfo: {
    [key: string]: {
      duration: number,
      logGroupName: string,
      logStreamName: string,
      requestId: string,
      startTime: number,
      endTime: number,
    }[]
  } = {};
  for (let x = 1; x <= iterationSplits; x++) {
    for (const fn of fns) {
      if (!cwLookupInfo[fn.url]) {
        cwLookupInfo[fn.url] = [];
      }
      if (!durations[fn.url]) {
        durations[fn.url] = [];
      }
      const promises = [];
      for (let i = 0; i < (iterations / iterationSplits); i++) {
        promises.push(getRequest(fn.url));
      }
      const invokeResults = await Promise.all(promises);

      for (const invokeResult of invokeResults) {
        durations[fn.url].push(invokeResult['duration']);
        cwLookupInfo[fn.url].push({
          duration: invokeResult['duration'],
          logGroupName: invokeResult['logGroupName'],
          logStreamName: invokeResult['logStreamName'],
          requestId: invokeResult['requestId'],
          startTime: invokeResult['startTime'],
          endTime: invokeResult['endTime'],
        });
      }
    }
  }

  // now enter the data into the dynamodb table
  for (const fn of fns) {
    const getCommand = new GetFunctionCommand({ FunctionName: fn.arn });
    const getResult = await lambdaClient.send(getCommand);
    const stats = getStats(durations[fn.url], [], getResult.Configuration);

    const command = new PutCommand({
      Item: {
        ...stats,
        getResultConfiguration: getResult.Configuration,
        CwLookupInfo: cwLookupInfo[fn.url],
        LastCall: Math.max(...cwLookupInfo[fn.url].map((x) => x['endTime'])),
        Date: date,
        pk: stats.Runtime,
        sk: `${date}#${fn.apiG}-${stats.FunctionName}`,
      },
      TableName: tableName,
    });
    await docClient.send(command);
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ Status: 'Complete.' }),
  };
};
