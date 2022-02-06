import { Duration, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import { AttributeType, BillingMode, Table } from 'aws-cdk-lib/aws-dynamodb';
import { Policy, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import {
  Architecture,
  Function as LambdaFunction,
  Runtime,
} from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import {
  HttpUrlIntegration,
  HttpLambdaIntegration,
} from '@aws-cdk/aws-apigatewayv2-integrations-alpha';
import { HttpApi, HttpMethod } from '@aws-cdk/aws-apigatewayv2-alpha';

interface ServerlessBenchmarksStackProps extends StackProps {
  functions: LambdaFunction[];
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

    const getBenchmarksFn = new NodejsFunction(this, 'get-benchmarks-fn', {
      ...lambdaProps,
      entry: `${__dirname}/../fns/get-benchmarks.ts`,
      functionName: 'getBenchmarks',
    });

    table.grantReadData(getBenchmarksFn);

    const getBenchmarksIntegration = new HttpLambdaIntegration(
      'GetBenchmarksIntegration',
      getBenchmarksFn
    );

    const httpApi = new HttpApi(this, 'BenchmarksApi');

    httpApi.addRoutes({
      integration: getBenchmarksIntegration,
      methods: [HttpMethod.GET],
      path: '/benchmarks',
    });
  }
}
