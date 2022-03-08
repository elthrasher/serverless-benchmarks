import {
  CloudWatchLogsClient,
  FilterLogEventsCommand,
} from '@aws-sdk/client-cloudwatch-logs';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { getStats } from './util';

const cloudwatchlogsClient = new CloudWatchLogsClient({});
const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

const tableName = process.env.TABLE_NAME;
const bufferForCloudWatchEndTime = 50;

export const handler = async () => {
  const delayBeforeLooking = 10 * 60000; // minutes
  const currentTime = new Date().getTime();

  // Query the dynamodb table, to find items that need data from CloudWatch Logs to complete their entries
  const getItemsToUpdateCommand = new QueryCommand({
    TableName: 'Benchmarks', //tableName,
    IndexName: 'itemsThatNeedCwData',
    ExpressionAttributeValues: {
      ':pk': 'nodejs14.x',
      ':lc': currentTime - delayBeforeLooking,
    },
    KeyConditionExpression: 'pk = :pk and LastCall < :lc',
  });
  const itemsToUpdate = await docClient.send(getItemsToUpdateCommand);

  // Get the CloudWatch lookup information in order to request it with the least total requests to CloudWatch Logs
  if (itemsToUpdate && itemsToUpdate.Items) {
    const justCwLookupInfo = itemsToUpdate.Items.map(item => item.CwLookupInfo);

    let logGroupsToGet: {
      [key: string]: {
        'startTime': number,
        'endTime': number,
        'logStreamNames': string[],
      }
    } = {};

    for (const items of justCwLookupInfo) {
      for (const item of items) {
        if (logGroupsToGet.hasOwnProperty(item['logGroupName'])) {
          if (logGroupsToGet[item['logGroupName']]['startTime'] > item['startTime']) {
            logGroupsToGet[item['logGroupName']]['startTime'] = item['startTime'];
          }
          if (logGroupsToGet[item['logGroupName']]['endTime'] < item['endTime']) {
            logGroupsToGet[item['logGroupName']]['endTime'] = item['endTime'];
          }
          logGroupsToGet[item['logGroupName']]['logStreamNames'].push(item['logStreamName']);
        } else {
          logGroupsToGet[item['logGroupName']] = {
            'startTime': item['startTime'],
            'endTime': item['endTime'],
            'logStreamNames': [item['logStreamName']],
          };
        }
      }
    }

    // to store all of the events we retrieve from Cloud Watch Logs, later will be used to match them to the requests
    let allEvents: any[] = [];

    for (const logGroupToGet of Object.keys(logGroupsToGet)) {
      // console.log(logGroupToGet, "logGroupsToGet[logGroupToGet]['logStreamNames'].length", logGroupsToGet[logGroupToGet]['logStreamNames'].length)

      // FilterLogEventsCommand will only accept 100 log stream names at a time, so need to slice this into chunks of 100 and loop through them
      for (let sliceStart = 0; sliceStart < logGroupsToGet[logGroupToGet]['logStreamNames'].length; sliceStart += 100) {
        let cwEvents: any = {};
        let iteration = 0;

        // using a do,while loop for continuing to request until the nextToken key is undefined.
        do {
          iteration++;
          let filterLogEventsCommandParameters: any = {
            logGroupName: logGroupToGet,
            logStreamNames: logGroupsToGet[logGroupToGet]['logStreamNames'].slice(sliceStart, sliceStart + 100),  // 100 Stream Names is the maximum supported.
            startTime: logGroupsToGet[logGroupToGet]['startTime'],
            endTime: (logGroupsToGet[logGroupToGet]['endTime'] + bufferForCloudWatchEndTime),
            filterPattern: "REPORT",
          }
          if (cwEvents['nextToken']) {
            filterLogEventsCommandParameters['nextToken'] = cwEvents['nextToken'];
          }
          const filterLogEventsCommand = new FilterLogEventsCommand(filterLogEventsCommandParameters);
          cwEvents = await cloudwatchlogsClient.send(filterLogEventsCommand);

          // console.log('cwEvents:', cwEvents);

          const toAddToAllEvents = cwEvents.events.map(item => ({ ...item, logGroupName: logGroupToGet }));
          allEvents = allEvents.concat(...toAddToAllEvents);
          // console.log(logGroupToGet, `${sliceStart}-${sliceStart + 100}`, 'iteration', iteration, 'cwEvents.events.length:', cwEvents.events.length);
        }
        while (cwEvents['nextToken']);

        // console.log('allEvents.length:', allEvents.length);
      }
    };
    // console.log('Done retrieving events from CloudWatch, ready to start matching them to their requests', 'allEvents.length:', allEvents.length);
    // now go through DynamoDB record by record, completing each one.
    for (const itemToUpdate of itemsToUpdate.Items) {

      const pk = itemToUpdate.pk;
      const sk = itemToUpdate.sk;
      const date = itemToUpdate.Date;
      const getResultConfiguration = itemToUpdate.getResultConfiguration;

      const durations = [];
      const inits = [];
      for (const cwLookupItem of itemToUpdate.CwLookupInfo) {

        const itemOfInterest = allEvents.find(item => {
          return (item.logGroupName == cwLookupItem.logGroupName
            && item.logStreamName == cwLookupItem.logStreamName
            && item.message.startsWith(`REPORT RequestId: ${cwLookupItem.requestId}`)
            && item.timestamp >= cwLookupItem.startTime
            && item.timestamp <= (cwLookupItem.endTime + bufferForCloudWatchEndTime)
          )
        });

        if (!itemOfInterest) {
          console.log('found nothing for:', cwLookupItem);
          console.log(`REPORT RequestId: ${cwLookupItem.requestId}`);
          return;
        } else {
          const init = parseFloat(itemOfInterest.message.split('Init Duration: ')[1] || '0');
          durations.push(cwLookupItem.duration);
          inits.push(init);
        }
      }

      const stats = getStats(durations, inits, getResultConfiguration);

      const command = new PutCommand({
        Item: {
          ...stats,
          Date: date,
          pk: pk,
          sk: sk,
        },
        TableName: tableName,
      });
      await docClient.send(command);
    }
  }
}
