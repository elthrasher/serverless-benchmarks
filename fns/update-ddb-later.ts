import {
  CloudWatchLogsClient,
  GetLogEventsCommand,
} from '@aws-sdk/client-cloudwatch-logs';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';

import { CloudWatchStats } from './benchmarkViaHttp';

const cloudwatchlogsClient = new CloudWatchLogsClient({});
const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

const tableName = process.env.TABLE_NAME;

export const handler = async () => {
  const delayBeforeLooking = 10 * 60000; // minutes
  const currentTime = new Date().getTime();

  // query the dynamodb table, to find items that need to be looked up in CloudWatch Logs
  const command = new QueryCommand({
    TableName: 'Benchmarks', //tableName,
    IndexName: 'itemsThatNeedCwData',
    ExpressionAttributeValues: {
      ':pk': 'nodejs14.x',
      ':lc': currentTime - delayBeforeLooking,
    },
    KeyConditionExpression: 'pk = :pk and LastCall < :lc',
  });
  const data = await docClient.send(command);
  // console.log('data:', data);
  // console.log('CwLookupInfo:', [0].CwLookupInfo)

  console.log('data.Items.length:', data?.Items?.length);
  data?.Items?.forEach((item) => {
    const durations = [];
    const inits = [];
    const getResultConfiguration = item.getResultConfiguration;

    console.log('item.CwLookupInfo.length:', item.CwLookupInfo.length);

    let count = 0;
    item.CwLookupInfo.forEach(async (cwLookupItem: CloudWatchStats) => {
      count++;

      console.log(count + '. cwLookupItem:', cwLookupItem);
      // get the CloudWatch logs of the target lambda's invocation
      const duration = cwLookupItem['duration'];

      console.log('duration1:', duration);
      const getLogEventsCommand = new GetLogEventsCommand({
        logGroupName: cwLookupItem['logGroupName'],
        logStreamName: cwLookupItem['logStreamName'],
        startTime: cwLookupItem['startTime'],
        endTime: cwLookupItem['endTime'],
      });
      console.log('duration2:', duration);
      try {
        const cwEvents = await cloudwatchlogsClient.send(getLogEventsCommand);
        console.log('duration3:', duration);
        console.log('cwEvents:', cwEvents);
      } catch (error) {
        console.error('error:', error);
      }

      // if (cwEvents) {
      //   const cwRecordOfInterest = cwEvents.events.find(item => item.message.startsWith(`REPORT RequestId: ${cwLookupItem['requestId']}`));

      //   console.log('cwEvents:', cwEvents);
      //   console.log('cwRecordOfInterest:', cwRecordOfInterest);

      //   const init = parseFloat(cwRecordOfInterest.message.split('Init Duration: ')[1] || '0');

      //   durations.push(duration);
      //   inits.push(init);

      //   console.log('init:', init)
      // } else {
      //   console.log('Got nothing! GetLogsParams:', {
      //     logGroupName: cwLookupItem['logGroupName'],
      //     logStreamName: cwLookupItem['logStreamName'],
      //     startTime: cwLookupItem['startTime'],
      //     endTime: cwLookupItem['endTime']
      //   });
      // }
    });

    // const stats = getStats(durations, inits, getResultConfiguration);

    // const command = new PutCommand({
    //   Item: {
    //     ...stats,
    //     Date: date,
    //     pk: stats.Runtime,
    //     sk: `${date}#${fn.apiG}-${stats.FunctionName}`,
    //   },
    //   TableName: tableName,
    // });
    // await docClient.send(command);
  });
};
