import { EC2Client, DescribeInstancesCommand } from '@aws-sdk/client-ec2';
import { LambdaClient, ListFunctionsCommand } from '@aws-sdk/client-lambda';
import { GetObjectCommand, ListBucketsCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';

interface AWSClientConfig {
  region?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
}

export interface S3Bucket {
  name: string;
  creationDate?: Date;
}

export interface S3Object {
  key: string;
  size: number;
  lastModified?: Date;
  etag?: string;
  storageClass?: string;
}

export interface EC2Instance {
  instanceId: string;
  instanceType: string;
  state: string;
  publicIpAddress?: string;
  privateIpAddress?: string;
  launchTime?: Date;
  name?: string;
  availabilityZone?: string;
}

export interface LambdaFunction {
  functionName: string;
  functionArn: string;
  runtime?: string;
  handler?: string;
  codeSize: number;
  lastModified: string;
  memorySize?: number;
  timeout?: number;
  description?: string;
}

export class AWSClient {
  private region: string;
  private credentials: { accessKeyId: string; secretAccessKey: string };

  constructor(config?: AWSClientConfig) {
    this.region = config?.region ?? process.env.AWS_REGION ?? 'us-east-1';
    this.credentials = {
      accessKeyId: config?.accessKeyId ?? process.env.AWS_ACCESS_KEY_ID ?? '',
      secretAccessKey: config?.secretAccessKey ?? process.env.AWS_SECRET_ACCESS_KEY ?? '',
    };

    if (!this.credentials.accessKeyId || !this.credentials.secretAccessKey) {
      throw new Error(
        'AWS credentials are required. Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY environment variables.',
      );
    }
  }

  private getS3Client(): S3Client {
    return new S3Client({ region: this.region, credentials: this.credentials });
  }

  private getEC2Client(region?: string): EC2Client {
    return new EC2Client({ region: region ?? this.region, credentials: this.credentials });
  }

  private getLambdaClient(region?: string): LambdaClient {
    return new LambdaClient({ region: region ?? this.region, credentials: this.credentials });
  }

  private formatErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'Unknown error';
  }

  async listS3Buckets(): Promise<S3Bucket[]> {
    const client = this.getS3Client();

    try {
      const response = await client.send(new ListBucketsCommand({}));
      return (response.Buckets ?? []).map(bucket => ({
        name: bucket.Name ?? '',
        creationDate: bucket.CreationDate,
      }));
    } catch (error) {
      throw new Error(`Failed to list S3 buckets: ${this.formatErrorMessage(error)}`);
    }
  }

  async listS3Objects(bucket: string, prefix?: string, maxKeys?: number): Promise<S3Object[]> {
    const client = this.getS3Client();

    try {
      const response = await client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: prefix,
          MaxKeys: maxKeys ?? 1000,
        }),
      );

      return (response.Contents ?? []).map(object => ({
        key: object.Key ?? '',
        size: object.Size ?? 0,
        lastModified: object.LastModified,
        etag: object.ETag,
        storageClass: object.StorageClass,
      }));
    } catch (error) {
      throw new Error(`Failed to list S3 objects in bucket ${bucket}: ${this.formatErrorMessage(error)}`);
    }
  }

  async getS3Object(bucket: string, key: string): Promise<string> {
    const client = this.getS3Client();

    try {
      const response = await client.send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: key,
        }),
      );

      if (!response.Body) throw new Error('Object body is empty');

      return response.Body.transformToString();
    } catch (error) {
      throw new Error(`Failed to get S3 object ${key} from bucket ${bucket}: ${this.formatErrorMessage(error)}`);
    }
  }

  async listEC2Instances(region?: string): Promise<EC2Instance[]> {
    const client = this.getEC2Client(region);

    try {
      const response = await client.send(new DescribeInstancesCommand({}));

      return (response.Reservations ?? []).flatMap(reservation =>
        (reservation.Instances ?? []).map(instance => {
          const nameTag = instance.Tags?.find(tag => tag.Key === 'Name');

          return {
            instanceId: instance.InstanceId ?? '',
            instanceType: instance.InstanceType ?? '',
            state: instance.State?.Name ?? 'unknown',
            publicIpAddress: instance.PublicIpAddress,
            privateIpAddress: instance.PrivateIpAddress,
            launchTime: instance.LaunchTime,
            name: nameTag?.Value,
            availabilityZone: instance.Placement?.AvailabilityZone,
          };
        }),
      );
    } catch (error) {
      throw new Error(`Failed to list EC2 instances: ${this.formatErrorMessage(error)}`);
    }
  }

  async listLambdaFunctions(region?: string): Promise<LambdaFunction[]> {
    const client = this.getLambdaClient(region);

    try {
      const response = await client.send(new ListFunctionsCommand({}));

      return (response.Functions ?? []).map(func => ({
        functionName: func.FunctionName ?? '',
        functionArn: func.FunctionArn ?? '',
        runtime: func.Runtime,
        handler: func.Handler,
        codeSize: func.CodeSize ?? 0,
        lastModified: func.LastModified ?? '',
        memorySize: func.MemorySize,
        timeout: func.Timeout,
        description: func.Description,
      }));
    } catch (error) {
      throw new Error(`Failed to list Lambda functions: ${this.formatErrorMessage(error)}`);
    }
  }
}

let awsClient: AWSClient | null = null;

export function getAWSClient(config?: AWSClientConfig): AWSClient {
  if (awsClient) return awsClient;

  awsClient = new AWSClient(config);
  return awsClient;
}

export default AWSClient;
