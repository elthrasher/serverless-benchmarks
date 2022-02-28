import {
  Aws,
  aws_apigateway as apigateway,
  aws_iam as iam,
  Duration,
  RemovalPolicy,
  Stack,
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

import { HttpApis } from './csv2ddb-stack';

interface ServerlessBenchmarksStackProps extends StackProps {
  functions: LambdaFn[];
  httpApisA: HttpApis[];
  httpApisB: HttpApis[];
  httpApisC: HttpApis[];
}

export class ServerlessBenchmarksStack extends Stack {
  constructor(
    scope: Construct,
    id: string,
    props: ServerlessBenchmarksStackProps
  ) {
    super(scope, id, props);

    const table = new Table(this, 'BenchmarksTable', {
      billingMode: BillingMode.PAY_PER_REQUEST,
      partitionKey: { name: 'pk', type: AttributeType.STRING },
      removalPolicy: RemovalPolicy.DESTROY,
      sortKey: { name: 'sk', type: AttributeType.STRING },
      tableName: 'Benchmarks',
    });

    table.addGlobalSecondaryIndex({
      indexName: 'itemsThatNeedCwData',
      partitionKey: {
        name: 'pk',
        type: AttributeType.STRING,
      },
      sortKey: {
        name: 'LastCall',
        type: AttributeType.NUMBER,
      },
    });

    const lambdaProps = {
      architecture: Architecture.ARM_64,
      bundling: { minify: true, sourceMap: true },
      environment: {
        COMMA_SEP_ARNS: props.functions.map((fn) => fn.functionArn).join(','),
        JSON_STRINGIFIED_TARGETS_A: JSON.stringify(props.httpApisA),
        JSON_STRINGIFIED_TARGETS_B: JSON.stringify(props.httpApisB),
        JSON_STRINGIFIED_TARGETS_C: JSON.stringify(props.httpApisC),
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
      entry: `${__dirname}/../fns/benchmark.ts`,
      functionName: 'benchmark',
    });

    table.grantWriteData(benchmarkFn);

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

    const benchmarkViaHttpFn = new NodejsFunction(
      this,
      'benchmark-via-http-fn',
      {
        ...lambdaProps,
        timeout: Duration.minutes(15),
        entry: `${__dirname}/../fns/benchmarkViaHttp.ts`,
        functionName: 'benchmarkViaHttp',
      }
    );
    table.grantWriteData(benchmarkViaHttpFn);

    const updateDdbLaterFn = new NodejsFunction(this, 'update-ddb-later-fn', {
      ...lambdaProps,
      timeout: Duration.minutes(15),
      entry: `${__dirname}/../fns/update-ddb-later.ts`,
      functionName: 'updateDdbLater',
    });
    table.grantReadData(updateDdbLaterFn);

    updateDdbLaterFn.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        resources: ['*'],
        actions: ['logs:GetLogEvents'],
      })
    );

    for (const fn of props.functions) {
      benchmarkViaHttpFn.role?.attachInlinePolicy(
        new Policy(this, `get-${fn.node.id}-viaHttp-policy`, {
          statements: [
            new PolicyStatement({
              actions: ['lambda:GetFunction'],
              resources: [fn.functionArn],
            }),
          ],
        })
      );
    }

    const benchmarkTarget = new LambdaFunction(benchmarkFn);
    const benchmarkViaHttpTargetA = new LambdaFunction(benchmarkViaHttpFn);
    const benchmarkViaHttpTargetB = new LambdaFunction(benchmarkViaHttpFn);
    const benchmarkViaHttpTargetC = new LambdaFunction(benchmarkViaHttpFn);

    new Rule(this, 'BenchmarkRule', {
      ruleName: 'LambdaBenchmarkRule',
      schedule: Schedule.cron({ hour: '1', minute: '0' }),
      targets: [benchmarkTarget],
    });

    new Rule(this, 'BenchmarkRuleA', {
      ruleName: 'LambdaBenchmarkRuleA',
      schedule: Schedule.cron({ hour: '2', minute: '0' }),
      targets: [benchmarkViaHttpTargetA],
    });

    new Rule(this, 'BenchmarkRuleB', {
      ruleName: 'LambdaBenchmarkRuleB',
      schedule: Schedule.cron({ hour: '3', minute: '0' }),
      targets: [benchmarkViaHttpTargetB],
    });

    new Rule(this, 'BenchmarkRuleC', {
      ruleName: 'LambdaBenchmarkRuleC',
      schedule: Schedule.cron({ hour: '4', minute: '0' }),
      targets: [benchmarkViaHttpTargetC],
    });

    const restApi = new apigateway.RestApi(this, 'Benchmarks');

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
