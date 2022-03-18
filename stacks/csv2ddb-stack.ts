import { Duration, RemovalPolicy, StackProps } from 'aws-cdk-lib';
import { AttributeType, BillingMode, Table } from 'aws-cdk-lib/aws-dynamodb';
import {
  Architecture,
  Code,
  Function as LambdaFunction,
  LayerVersion,
  Runtime,
} from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import { BucketDeployment, Source } from 'aws-cdk-lib/aws-s3-deployment';
import { Construct } from 'constructs';
import * as sst from "@serverless-stack/resources";

export default class Csv2DDBStack extends sst.Stack {
  public functions: LambdaFunction[];

  constructor(
    scope: sst.App,
    id: string,
    props?: sst.StackProps
  ) {
    super(scope, id, props);

    const fileSize = 100; // 100 or 1000

    const table = new sst.Table(this, 'Sales', {
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

    const bucket = new Bucket(this, 'SalesCsvBucket', {
      autoDeleteObjects: true,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    new BucketDeployment(this, 'SalesCsvDeployment', {
      destinationBucket: bucket,
      sources: [Source.asset('./assets')],
    });

    const lambdaProps = {
      architecture: Architecture.ARM_64,
      bundling: { minify: true, sourceMap: true, externalModules: [] },
      environment: {
        BUCKET_NAME: bucket.bucketName,
        BUCKET_KEY: `${fileSize} Sales Records.csv`,
        NODE_OPTIONS: '--enable-source-maps',
        TABLE_NAME: table.tableName,
      },
      logRetention: RetentionDays.ONE_DAY,
      memorySize: 512,
      runtime: Runtime.NODEJS_14_X,
      timeout: Duration.minutes(1),
    };

    const csv2ddbSdk2 = new NodejsFunction(this, 'csv2ddb-sdk2', {
      ...lambdaProps,
      bundling: { ...lambdaProps.bundling },
      description: `Reads ${fileSize} rows of CSV and writes to DynamoDB. Installs full aws-sdk v2.`,
      entry: './fns/csv2ddb-sdk2.ts',
      functionName: `${this.stage}-csv2ddb-sdk2`,
    });

    const csv2ddbSdk2Clients = new NodejsFunction(
      this,
      'csv2ddb-sdk2-clients',
      {
        ...lambdaProps,
        bundling: { ...lambdaProps.bundling },
        description: `Reads ${fileSize} rows of CSV and writes to DynamoDB. Installs only clients from aws-sdk v2.`,
        entry: './fns/csv2ddb-sdk2-clients.ts',
        functionName: `${this.stage}-csv2ddb-sdk2-clients`,
      }
    );

    const csv2ddbSdk2Native = new NodejsFunction(this, 'csv2ddb-sdk2-native', {
      ...lambdaProps,
      bundling: { ...lambdaProps.bundling, externalModules: ['aws-sdk'] },
      description: `Reads ${fileSize} rows of CSV and writes to DynamoDB. Uses native aws-sdk v2.`,
      entry: './fns/csv2ddb-sdk2.ts',
      functionName: `${this.stage}-csv2ddb-sdk2-native`,
    });

    const sdkLayer = new LayerVersion(this, 'SdkLayer', {
      code: Code.fromAsset(`./node_modules/aws-sdk`),
    });

    const csv2ddbSdk2Layer = new NodejsFunction(this, 'csv2ddb-sdk2-layer', {
      ...lambdaProps,
      bundling: { ...lambdaProps.bundling, externalModules: ['aws-sdk'] },
      description: `Reads ${fileSize} rows of CSV and writes to DynamoDB. Uses layer aws-sdk v2.`,
      entry: './fns/csv2ddb-sdk2.ts',
      functionName: `${this.stage}-csv2ddb-sdk2-layer`,
      layers: [sdkLayer],
    });

    const csv2ddbSdk3 = new NodejsFunction(this, 'csv2ddb-sdk3', {
      ...lambdaProps,
      bundling: { ...lambdaProps.bundling },
      description: `Reads ${fileSize} rows of CSV and writes to DynamoDB. Uses modular aws sdk v3.`,
      entry: './fns/csv2ddb-sdk3.ts',
      functionName: `${this.stage}-csv2ddb-sdk3`,
    });

    this.functions = [
      csv2ddbSdk2,
      csv2ddbSdk2Clients,
      csv2ddbSdk2Native,
      csv2ddbSdk2Layer,
      csv2ddbSdk3,
    ];

    this.functions.forEach((fn) => {
      bucket.grantRead(fn);
      table.dynamodbTable.grantWriteData(fn);
    });
  }
}
