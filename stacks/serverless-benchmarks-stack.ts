import {
  Aws,
  aws_apigateway as apigateway,
  aws_iam as iam,
  Duration,
  RemovalPolicy,
  StackProps,
} from 'aws-cdk-lib';
import { AttributeType, BillingMode, Table } from 'aws-cdk-lib/aws-dynamodb';
import { Rule, Schedule } from 'aws-cdk-lib/aws-events';
import { LambdaFunction } from 'aws-cdk-lib/aws-events-targets';
import { Policy, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import {
  Architecture,
  Function as LambdaFn,
  Runtime,
} from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import * as sst from "@serverless-stack/resources";

interface ServerlessBenchmarksStackProps extends sst.StackProps {
  functions: LambdaFn[];
}

export default class ServerlessBenchmarksStack extends sst.Stack {
  constructor(
    scope: sst.App,
    id: string,
    props: ServerlessBenchmarksStackProps
  ) {
    super(scope, id, props);

    const table = new sst.Table(this, 'Benchmarks', {
      fields: {
        pk: sst.TableFieldType.STRING,
        sk: sst.TableFieldType.STRING,
      },
      primaryIndex: { partitionKey: "pk", sortKey: "sk" },
      dynamodbTable: {
        billingMode: BillingMode.PAY_PER_REQUEST,
        removalPolicy: RemovalPolicy.DESTROY,
      }
    });

    const lambdaProps = {
      architecture: Architecture.ARM_64,
      bundling: { minify: true, sourceMap: true },
      environment: {
        COMMA_SEP_ARNS: props.functions.map((fn) => fn.functionArn).join(','),
        NODE_OPTIONS: '--enable-source-maps',
        TABLE_NAME: table.tableName,
      },
      logRetention: RetentionDays.ONE_DAY,
      memorySize: 512,
      runtime: Runtime.NODEJS_14_X,
      timeout: Duration.minutes(5),
    };

    const benchmarkFn = new NodejsFunction(this, 'benchmark-fn', {
      ...lambdaProps,
      entry: './fns/benchmark.ts',
      functionName: `${this.stage}-benchmark`,
    });

    table.dynamodbTable.grantWriteData(benchmarkFn);

    for (const fn of props.functions) {
      benchmarkFn.role?.attachInlinePolicy(
        new Policy(this, `get-${fn.node.id}-policy`, {
          statements: [
            new PolicyStatement({
              actions: ['lambda:GetFunction'],
              resources: [fn.functionArn],
            }),
          ],
        })
      );
      fn.grantInvoke(benchmarkFn);
    }

    const benchmarkTarget = new LambdaFunction(benchmarkFn);

    new Rule(this, 'BenchmarkRule', {
      ruleName: `${this.stage}-LambdaBenchmarkRule`,
      schedule: Schedule.cron({ hour: '7', minute: '0' }),
      targets: [benchmarkTarget],
    });

    const restApi = new apigateway.RestApi(this, `${this.stage}-BenchmarksApi`);

    const restApiRole = new iam.Role(this, 'BenchmarksRole', {
      assumedBy: new iam.ServicePrincipal('apigateway.amazonaws.com'),
    });

    restApiRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        resources: [
          `arn:aws:dynamodb:${Aws.REGION}:${Aws.ACCOUNT_ID}:table/${table.tableName}`,
        ],
        actions: ['dynamodb:Query'],
      })
    );

    const rootIntegration = new apigateway.MockIntegration({
      passthroughBehavior: apigateway.PassthroughBehavior.NEVER,
      requestTemplates: {
        'application/json': '{ "statusCode": 200 }',
      },
      integrationResponses: [
        {
          statusCode: '200',
          responseTemplates: {
            'text/html': `<!DOCTYPE html>
               <html lang="en">
               <head>
               <title>Benchmarks</title>
               <meta charset="UTF-8">
               <meta name="viewport" content="width=device-width, initial-scale=1">
               </head>
               <body>
               <a href="ui/">UI</a>
               </br>
               <a href="api/">API</a>
               </body>
               </html>`,
          },
        },
      ],
    });

    const dynamoDbQuery = `{"TableName": "${table.tableName}",
        "ExpressionAttributeValues": { ":pk": {"S": "nodejs14.x"} },
        "KeyConditionExpression": "pk = :pk",
        "Limit": 25,
        "ScanIndexForward": false
    }`;

    const uiIntegration = new apigateway.AwsIntegration({
      service: 'dynamodb',
      action: 'Query',
      options: {
        credentialsRole: restApiRole,
        requestTemplates: {
          'application/json': dynamoDbQuery,
        },
        integrationResponses: [
          {
            statusCode: '200',
            responseTemplates: {
              'text/html': `#set($items = $input.path('$.Items'))
               <!DOCTYPE html>
               <html lang="en">
               <head>
               <title>Benchmarks</title>
               <meta charset="UTF-8">
               <meta name="viewport" content="width=device-width, initial-scale=1">
               <link rel="stylesheet" type="text/css" href="https://cdn.datatables.net/1.11.4/css/jquery.dataTables.min.css">
               <script type="text/javascript" language="javascript" src="https://code.jquery.com/jquery-3.5.1.js"></script>
               <script type="text/javascript" language="javascript" src="https://cdn.datatables.net/1.11.4/js/jquery.dataTables.min.js"></script>
               <script>
               $(document).ready( function () {
                $('table').DataTable({"iDisplayLength": 50});
               } );
               </script>
               </head>
               <body>
               <table>
               <thead>
               <tr>
               <th>pk</th>
               <th>sk</th>
               <th>SourceMapsEnabled</th>
               <th>Date</th>
               <th>Architectures</th>
               <th>MemorySize</th>
               <th>Description</th>
               <th>CodeSize</th>
               <th>FunctionName</th>
               <th>coldStartPercent</th>
               <th>ColdStarts median</th>
               <th>ColdStarts mean</th>
               <th>ColdStarts p90</th>
               <th>Runtime</th>
               <th>Durations median</th>
               <th>Durations mean</th>
               <th>Durations p90</th>
               </tr>
               </thead>
               <tbody>
               #foreach($item in $items)
               <tr>
               <td>$item.pk.S</td>
               <td>$item.sk.S</td>
               <td>$item.SourceMapsEnabled.BOOL</td>
               <td>$item.Date.S</td>
               <td>#foreach($arch in $item.Architectures.L)$arch.S#end</td>
               <td>$item.MemorySize.N</td>
               <td>$item.Description.S</td>
               <td>$item.CodeSize.N</td>
               <td>$item.FunctionName.S</td>
               <td>$item.ColdStarts.M.coldStartPercent.S</td>
               <td>$item.ColdStarts.M.median.N</td>
               <td>$item.ColdStarts.M.mean.N</td>
               <td>$item.ColdStarts.M.p90.N</td>
               <td>$item.Runtime.S</td>
               <td>$item.Durations.M.median.N</td>
               <td>$item.Durations.M.mean.N</td>
               <td>$item.Durations.M.p90.N</td>
               </tr>
               #end
               </tbody>
               </table>
               </body>
               </html>`,
            },
          },
        ],
      },
    });

    const apiIntegration = new apigateway.AwsIntegration({
      service: 'dynamodb',
      action: 'Query',
      options: {
        credentialsRole: restApiRole,
        requestTemplates: {
          'application/json': dynamoDbQuery,
        },
        integrationResponses: [
          {
            statusCode: '200',
            responseTemplates: { 'application/json': "$input.path('$').Items" },
          },
        ],
      },
    });

    restApi.root.addMethod('GET', rootIntegration, {
      methodResponses: [
        {
          statusCode: '200',
          responseModels: {
            'text/html': apigateway.Model.EMPTY_MODEL,
          },
        },
      ],
    });

    const api = restApi.root.addResource('api');
    api.addMethod('GET', apiIntegration, {
      methodResponses: [{ statusCode: '200' }],
    });

    const ui = restApi.root.addResource('ui');
    ui.addMethod('GET', uiIntegration, {
      methodResponses: [
        {
          statusCode: '200',
          responseModels: {
            'text/html': apigateway.Model.EMPTY_MODEL,
          },
        },
      ],
    });
  }
}
