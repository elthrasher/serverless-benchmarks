import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  GetFunctionCommand,
  InvokeCommand,
  LambdaClient,
} from '@aws-sdk/client-lambda';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';

import { getStats, parseLog } from './util';

const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});
const lambdaClient = new LambdaClient({});

const commaSepArns = process.env.COMMA_SEP_ARNS;
const tableName = process.env.TABLE_NAME;
const iterations = 100;

export const handler = async () => {
  if (!commaSepArns) {
    throw new Error('Missing env var!');
  }
  const functionArns = commaSepArns?.split(',');
  const date = new Date().toISOString().split('T')[0];
  for (const functionArn of functionArns) {
    const getCommand = new GetFunctionCommand({ FunctionName: functionArn });
    const getResult = await lambdaClient.send(getCommand);
    const promises = [];
    const durations = [];
    const inits = [];
    for (let i = 0; i < iterations; i++) {
      const invokeCommand = new InvokeCommand({
        FunctionName: functionArn,
        LogType: 'Tail',
      });
      promises.push(lambdaClient.send(invokeCommand));
    }
    const invokeResults = await Promise.all(promises);
    for (const invokeResult of invokeResults) {
      const [duration, init] = parseLog(invokeResult);
      durations.push(duration);
      inits.push(init);
    }

    const stats = getStats(durations, inits, getResult.Configuration);

    const command = new PutCommand({
      Item: {
        ...stats,
        pk: stats.Runtime,
        sk: `${date}#${stats.FunctionName}`,
      },
      TableName: tableName,
    });
    await docClient.send(command);
  }
};
