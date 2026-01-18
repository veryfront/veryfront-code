import { tool } from 'veryfront/tool';
import { z } from 'zod';
import { getAWSClient } from '../../lib/aws-client';

/**
 * Tool for listing all S3 buckets in the AWS account
 */
export const listS3BucketsTool = tool({
  name: 'list-s3-buckets',
  description: 'List all S3 buckets in your AWS account. Returns bucket names and creation dates.',
  input: z.object({}),
  execute: async () => {
    try {
      const client = getAWSClient();
      const buckets = await client.listS3Buckets();

      if (buckets.length === 0) {
        return {
          success: true,
          message: 'No S3 buckets found in your AWS account.',
          buckets: [],
        };
      }

      return {
        success: true,
        message: `Found ${buckets.length} S3 bucket${buckets.length === 1 ? '' : 's'}.`,
        buckets: buckets.map(bucket => ({
          name: bucket.name,
          creationDate: bucket.creationDate?.toISOString(),
        })),
        count: buckets.length,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to list S3 buckets',
        buckets: [],
      };
    }
  },
});

export default listS3BucketsTool;
