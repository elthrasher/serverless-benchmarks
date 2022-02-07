import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';

const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

const tableName = process.env.TABLE_NAME;

export const handler = async () => {
  const command = new QueryCommand({
    ExpressionAttributeValues: { ':pk': 'nodejs14.x' },
    KeyConditionExpression: 'pk = :pk',
    Limit: 25,
    ScanIndexForward: false,
    TableName: tableName,
  });
  const result = await docClient.send(command);
  return result.Items;
};
