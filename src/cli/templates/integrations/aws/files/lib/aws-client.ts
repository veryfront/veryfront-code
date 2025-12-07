import { S3Client, ListBucketsCommand, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';
import { EC2Client, DescribeInstancesCommand } from '@aws-sdk/client-ec2';
import { LambdaClient, ListFunctionsCommand } from '@aws-sdk/client-lambda';
import { fromEnv } from '@aws-sdk/credential-providers';

/**
 * AWS Client Configuration
 */
interface AWSClientConfig {
  region?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
}

/**
 * S3 Bucket Information
 */
export interface S3Bucket {
  name: string;
  creationDate?: Date;
}

/**
 * S3 Object Information
 */
export interface S3Object {
  key: string;
  size: number;
  lastModified?: Date;
  etag?: string;
  storageClass?: string;
}

/**
 * EC2 Instance Information
 */
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

/**
 * Lambda Function Information
 */
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

/**
 * AWS Client for interacting with AWS services
 */
export class AWSClient {
  private region: string;
  private credentials: {
    accessKeyId: string;
    secretAccessKey: string;
  };

  constructor(config?: AWSClientConfig) {
    this.region = config?.region || process.env.AWS_REGION || 'us-east-1';
    this.credentials = {
      accessKeyId: config?.accessKeyId || process.env.AWS_ACCESS_KEY_ID || '',
      secretAccessKey: config?.secretAccessKey || process.env.AWS_SECRET_ACCESS_KEY || '',
    };

    if (!this.credentials.accessKeyId || !this.credentials.secretAccessKey) {
      throw new Error('AWS credentials are required. Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY environment variables.');
    }
  }

  /**
   * Get S3 client instance
   */
  private getS3Client(): S3Client {
    return new S3Client({
      region: this.region,
      credentials: this.credentials,
    });
  }

  /**
   * Get EC2 client instance
   */
  private getEC2Client(region?: string): EC2Client {
    return new EC2Client({
      region: region || this.region,
      credentials: this.credentials,
    });
  }

  /**
   * Get Lambda client instance
   */
  private getLambdaClient(region?: string): LambdaClient {
    return new LambdaClient({
      region: region || this.region,
      credentials: this.credentials,
    });
  }

  /**
   * List all S3 buckets
   */
  async listS3Buckets(): Promise<S3Bucket[]> {
    const client = this.getS3Client();
    const command = new ListBucketsCommand({});

    try {
      const response = await client.send(command);
      return (response.Buckets || []).map(bucket => ({
        name: bucket.Name || '',
        creationDate: bucket.CreationDate,
      }));
    } catch (error) {
      throw new Error(`Failed to list S3 buckets: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * List objects in an S3 bucket
   */
  async listS3Objects(bucket: string, prefix?: string, maxKeys?: number): Promise<S3Object[]> {
    const client = this.getS3Client();
    const command = new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      MaxKeys: maxKeys || 1000,
    });

    try {
      const response = await client.send(command);
      return (response.Contents || []).map(object => ({
        key: object.Key || '',
        size: object.Size || 0,
        lastModified: object.LastModified,
        etag: object.ETag,
        storageClass: object.StorageClass,
      }));
    } catch (error) {
      throw new Error(`Failed to list S3 objects in bucket ${bucket}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get an object from S3
   */
  async getS3Object(bucket: string, key: string): Promise<string> {
    const client = this.getS3Client();
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    try {
      const response = await client.send(command);
      if (!response.Body) {
        throw new Error('Object body is empty');
      }

      // Convert stream to string
      const bodyContents = await response.Body.transformToString();
      return bodyContents;
    } catch (error) {
      throw new Error(`Failed to get S3 object ${key} from bucket ${bucket}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * List EC2 instances
   */
  async listEC2Instances(region?: string): Promise<EC2Instance[]> {
    const client = this.getEC2Client(region);
    const command = new DescribeInstancesCommand({});

    try {
      const response = await client.send(command);
      const instances: EC2Instance[] = [];

      for (const reservation of response.Reservations || []) {
        for (const instance of reservation.Instances || []) {
          // Find name tag
          const nameTag = instance.Tags?.find(tag => tag.Key === 'Name');

          instances.push({
            instanceId: instance.InstanceId || '',
            instanceType: instance.InstanceType || '',
            state: instance.State?.Name || 'unknown',
            publicIpAddress: instance.PublicIpAddress,
            privateIpAddress: instance.PrivateIpAddress,
            launchTime: instance.LaunchTime,
            name: nameTag?.Value,
            availabilityZone: instance.Placement?.AvailabilityZone,
          });
        }
      }

      return instances;
    } catch (error) {
      throw new Error(`Failed to list EC2 instances: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * List Lambda functions
   */
  async listLambdaFunctions(region?: string): Promise<LambdaFunction[]> {
    const client = this.getLambdaClient(region);
    const command = new ListFunctionsCommand({});

    try {
      const response = await client.send(command);
      return (response.Functions || []).map(func => ({
        functionName: func.FunctionName || '',
        functionArn: func.FunctionArn || '',
        runtime: func.Runtime,
        handler: func.Handler,
        codeSize: func.CodeSize || 0,
        lastModified: func.LastModified || '',
        memorySize: func.MemorySize,
        timeout: func.Timeout,
        description: func.Description,
      }));
    } catch (error) {
      throw new Error(`Failed to list Lambda functions: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}

/**
 * Create a singleton AWS client instance
 */
let awsClient: AWSClient | null = null;

export function getAWSClient(config?: AWSClientConfig): AWSClient {
  if (!awsClient) {
    awsClient = new AWSClient(config);
  }
  return awsClient;
}

export default AWSClient;
