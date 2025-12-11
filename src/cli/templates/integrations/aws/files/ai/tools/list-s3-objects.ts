import { tool } from 'veryfront/ai';
import { z } from 'zod';
import { getAWSClient } from '../../lib/aws-client';

export const listS3ObjectsTool = tool({
  name: 'list-s3-objects',
  description: 'List objects in a specific S3 bucket. Optionally filter by prefix and limit the number of results.',
  input: z.object({
    bucket: z.string().describe('The name of the S3 bucket to list objects from'),
    prefix: z.string().optional().describe('Optional prefix to filter objects (e.g., "folder/" or "images/")'),
    maxKeys: z.number().min(1).max(1000).optional().describe('Maximum number of objects to return (default: 1000)'),
  }),
  execute: async ({ bucket, prefix, maxKeys }) => {
    try {
      const client = getAWSClient();
      const objects = await client.listS3Objects(bucket, prefix, maxKeys);

      if (objects.length === 0) {
        const prefixMessage = prefix ? ` with prefix "${prefix}"` : '';
        return {
          success: true,
          message: `No objects found in bucket "${bucket}"${prefixMessage}.`,
          objects: [],
          bucket,
          prefix,
        };
      }

      return {
        success: true,
        message: `Found ${objects.length} object${objects.length === 1 ? '' : 's'} in bucket "${bucket}"${prefix ? ` with prefix "${prefix}"` : ''}.`,
        objects: objects.map(obj => ({
          key: obj.key,
          size: obj.size,
          lastModified: obj.lastModified?.toISOString(),
          etag: obj.etag,
          storageClass: obj.storageClass,
        })),
        count: objects.length,
        bucket,
        prefix,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to list S3 objects',
        objects: [],
        bucket,
        prefix,
      };
    }
  },
});

export default listS3ObjectsTool;
