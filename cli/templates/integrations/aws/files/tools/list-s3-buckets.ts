import { tool } from 'veryfront/tool';
import { z } from 'zod';
import { getAWSClient } from '../../lib/aws-client';

export const listS3BucketsTool = tool({
  id: 'list-s3-buckets',
  description: 'List all S3 buckets in your AWS account. Returns bucket names and creation dates.',
  inputSchema: z.object({}),
  execute: async () => {
    try {
      const client = getAWSClient();
      const buckets = await client.listS3Buckets();
      const count = buckets.length;

      if (count === 0) {
        return {
          success: true,
          message: 'No S3 buckets found in your AWS account.',
          buckets: [],
        };
      }

      return {
        success: true,
        message: `Found ${count} S3 bucket${count === 1 ? '' : 's'}.`,
        buckets: buckets.map((bucket) => ({
          name: bucket.name,
          creationDate: bucket.creationDate?.toISOString(),
        })),
        count,
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
