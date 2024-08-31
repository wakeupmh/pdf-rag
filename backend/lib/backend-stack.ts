import {
  Stack,
  StackProps,
  Duration,
  CfnOutput,
  RemovalPolicy,
  ArnFormat,
} from "aws-cdk-lib";
import { Construct } from "constructs";
import * as s3 from "aws-cdk-lib/aws-s3";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { Architecture, Runtime } from "aws-cdk-lib/aws-lambda";
import { bedrock } from "@cdklabs/generative-ai-cdk-constructs";
import { S3EventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import * as iam from "aws-cdk-lib/aws-iam";
import * as apigw from "aws-cdk-lib/aws-apigateway";
import * as wafv2 from "aws-cdk-lib/aws-wafv2";
import * as logs from "aws-cdk-lib/aws-logs";
import { join } from "path";

export class BackendStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    /** Knowledge Base */

    const knowledgeBase = new bedrock.KnowledgeBase(this, "knowledgeBase", {
      embeddingsModel: bedrock.BedrockFoundationModel.TITAN_EMBED_TEXT_V1,
    });

    /** S3 bucket for Bedrock data source */
    const sourceDocBkt = s3.Bucket.fromBucketArn(
      this,
      "source-doc-bkt",
      "arn:aws:s3:::doth-iaus"
    );

    const s3DataSource = new bedrock.S3DataSource(this, "s3DataSource", {
      bucket: sourceDocBkt,
      knowledgeBase: knowledgeBase,
      dataSourceName: "S3DataSource",
      chunkingStrategy: bedrock.ChunkingStrategy.FIXED_SIZE,
      maxTokens: 500,
      overlapPercentage: 20,
    });

    const s3PutEventSource = new S3EventSource(sourceDocBkt as s3.Bucket, {
      events: [s3.EventType.OBJECT_CREATED_PUT],
    });

    /** S3 Ingest Lambda for S3 data source */
    const lambdaIngestionJob = new NodejsFunction(this, "ingestion-job", {
      runtime: Runtime.NODEJS_20_X,
      entry: join(__dirname, "../lambda/ingest/index.js"),
      functionName: `start-ingestion-trigger`,
      timeout: Duration.minutes(15),
      environment: {
        KNOWLEDGE_BASE_ID: knowledgeBase.knowledgeBaseId,
        DATA_SOURCE_ID: s3DataSource.dataSourceId,
        BUCKET_ARN: sourceDocBkt.bucketArn,
      },
    });

    lambdaIngestionJob.addEventSource(s3PutEventSource);

    lambdaIngestionJob.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["bedrock:StartIngestionJob"],
        resources: [knowledgeBase.knowledgeBaseArn, sourceDocBkt.bucketArn],
      })
    );

    const whitelistedIps = [Stack.of(this).node.tryGetContext("allowedip")];

    const apiGateway = new apigw.RestApi(this, "rag", {
      description: "API for RAG",
      restApiName: "rag-api",
      defaultCorsPreflightOptions: {
        allowOrigins: apigw.Cors.ALL_ORIGINS,
      },
    });

    /** Lambda for handling retrieval and answer generation  */
    const lambdaQuery = new NodejsFunction(this, "query", {
      runtime: Runtime.NODEJS_20_X,
      entry: join(__dirname, "../lambda/query/index.js"),
      functionName: `query-bedrock-llm`,
      architecture: Architecture.ARM_64,
      //query lambda duration set to match API Gateway max timeout
      timeout: Duration.seconds(29),
      environment: {
        KNOWLEDGE_BASE_ID: knowledgeBase.knowledgeBaseId,
      },
    });

    lambdaQuery.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "bedrock:RetrieveAndGenerate",
          "bedrock:Retrieve",
          "bedrock:InvokeModel",
        ],
        resources: ["*"],
      })
    );

    apiGateway.root
      .addResource("docs")
      .addMethod("POST", new apigw.LambdaIntegration(lambdaQuery));

    apiGateway.addUsagePlan("usage-plan", {
      name: "dev-docs-plan",
      description: "usage plan for dev",
      apiStages: [
        {
          api: apiGateway,
          stage: apiGateway.deploymentStage,
        },
      ],
      throttle: {
        rateLimit: 100,
        burstLimit: 200,
      },
    });

    /**
     * Create and Associate ACL with Gateway
     */
    // Create an IPSet
    const allowedIpSet = new wafv2.CfnIPSet(this, "dev-ip-set", {
      addresses: whitelistedIps, // whitelisted IPs in CIDR format
      ipAddressVersion: "IPV4",
      scope: "REGIONAL",
      description: "List of allowed IP addresses",
    });
    // Create our Web ACL
    const webACL = new wafv2.CfnWebACL(this, "web-acl", {
      defaultAction: {
        block: {},
      },
      scope: "REGIONAL",
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        metricName: "webACL",
        sampledRequestsEnabled: true,
      },
      rules: [
        {
          name: "IPAllowList",
          priority: 1,
          statement: {
            ipSetReferenceStatement: {
              arn: allowedIpSet.attrArn,
            },
          },
          action: {
            allow: {},
          },
          visibilityConfig: {
            sampledRequestsEnabled: true,
            cloudWatchMetricsEnabled: true,
            metricName: "IPAllowList",
          },
        },
      ],
    });

    const webAclLogGroup = new logs.LogGroup(this, "aws-waf-logs", {
      logGroupName: `aws-waf-logs-backend`,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // Create logging configuration with log group as destination
    new wafv2.CfnLoggingConfiguration(this, "waf-logging-configuration", {
      resourceArn: webACL.attrArn,
      logDestinationConfigs: [
        Stack.of(this).formatArn({
          arnFormat: ArnFormat.COLON_RESOURCE_NAME,
          service: "logs",
          resource: "log-group",
          resourceName: webAclLogGroup.logGroupName,
        }),
      ],
    });

    // Associate with our gateway
    const webACLAssociation = new wafv2.CfnWebACLAssociation(
      this,
      "web-acl-association",
      {
        webAclArn: webACL.attrArn,
        resourceArn: `arn:aws:apigateway:${Stack.of(this).region}::/restapis/${
          apiGateway.restApiId
        }/stages/${apiGateway.deploymentStage.stageName}`,
      }
    );

    // make sure api gateway is deployed before web ACL association
    webACLAssociation.node.addDependency(apiGateway);

    //CfnOutput is used to log API Gateway URL and S3 bucket name to console
    new CfnOutput(this, "api-gateway-url", {
      value: apiGateway.url,
    });

    new CfnOutput(this, "DocsBucketName", {
      value: sourceDocBkt.bucketName,
    });
  }
}
