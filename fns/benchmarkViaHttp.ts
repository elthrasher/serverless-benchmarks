import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  GetFunctionCommand,
  LambdaClient,
} from '@aws-sdk/client-lambda';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { get } from 'https';
import { CloudWatchLogsClient, GetLogEventsCommand } from "@aws-sdk/client-cloudwatch-logs";

import { getStats } from './util';

const cloudwatchlogsClient = new CloudWatchLogsClient({});
const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});
const lambdaClient = new LambdaClient({});

const fns = JSON.parse(process.env.JSON_STRINGIFIED_TARGETS);
const tableName = process.env.TABLE_NAME;
const iterations = 100;

// original from https://bobbyhadz.com/blog/aws-lambda-http-request-nodejs
function getRequest(url: string) {
  const startTime = new Date().getTime();

  return new Promise((resolve, reject) => {
    const req = get(url, res => {
      let rawData = '';

      res.on('data', chunk => {
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
        });
      });
    });
    req.on('error', (err: string | undefined) => {
      reject(new Error(err));
    });
  });
}

async function getInitFromCwLogs(logGroupName: string, logStreamName: string, requestId: string) {
  const getLogEventsCommand = new GetLogEventsCommand({
    logGroupName: logGroupName,
    logStreamName: logStreamName,
    startFromHead: true,
  });
  const cwEvents = await cloudwatchlogsClient.send(getLogEventsCommand);
  const cwRecordOfInterest = cwEvents.events.find(item => item.message.startsWith(`REPORT RequestId: ${requestId}`));
  const init = parseFloat(cwRecordOfInterest.message.split('Init Duration: ')[1] || '0');
  return init;
}

export const handler = async (event: Object, context: Object) => {
  if (!fns) {
    throw new Error('Missing or incorrect env var!');
  }
  const date = new Date().toISOString().split('T')[0];

  for (const fn of fns) {
    const getCommand = new GetFunctionCommand({ FunctionName: fn.arn });
    const getResult = await lambdaClient.send(getCommand);
    const promises = [];
    const durations = [];
    const inits = [];
    for (let i = 0; i < iterations; i++) {
      promises.push(getRequest(fn.url));
    }
    const invokeResults = await Promise.all(promises);
    // TODO: come up with a better solution to looking for the CloudWatch logs before it exists.
    setTimeout(async () => {
      for (const invokeResult of invokeResults) {
        // get the CloudWatch logs of the target lambda's invocation
        const init = await getInitFromCwLogs(invokeResult['logGroupName'], invokeResult['logStreamName'], invokeResult['requestId'])
        inits.push(init);
        const duration = invokeResult['duration']; // TODO: find out if we can get this from API Gateway instead of measuring it ourselves.
        durations.push(duration);
      }

      const stats = getStats(durations, inits, getResult.Configuration);

      const command = new PutCommand({
        Item: {
          ...stats,
          Date: date,
          pk: stats.Runtime,
          sk: `${date}#${fn.apiG}-${stats.FunctionName}`,
        },
        TableName: tableName,
      });
      await docClient.send(command);
    }, 10000);
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ Status: 'Complete.' }),
  }
};
