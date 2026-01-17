import { tool } from 'veryfront/tool';
import { z } from 'zod';
import { getAWSClient } from '../../lib/aws-client';

/**
 * Tool for retrieving an object from S3
 */
export const getS3ObjectTool = tool({
  name: 'get-s3-object',
  description: 'Get the contents of an object from an S3 bucket. Returns the object content as a string.',
  input: z.object({
    bucket: z.string().describe('The name of the S3 bucket'),
    key: z.string().describe('The key (path) of the object to retrieve'),
  }),
  execute: async ({ bucket, key }) => {
    try {
      const client = getAWSClient();
      const content = await client.getS3Object(bucket, key);

      // Check if content is likely binary (this is a simple heuristic)
      const isBinary = /[\x00-\x08\x0E-\x1F]/.test(content.substring(0, 8000));

      if (isBinary) {
        return {
          success: true,
          message: `Retrieved object "${key}" from bucket "${bucket}". Content appears to be binary.`,
          bucket,
          key,
          contentType: 'binary',
          contentLength: content.length,
          contentPreview: '[Binary content - not displayed]',
        };
      }

      // For text content, provide preview if too long
      const maxPreviewLength = 10000;
      const contentPreview = content.length > maxPreviewLength
        ? content.substring(0, maxPreviewLength) + '\n... [truncated]'
        : content;

      return {
        success: true,
        message: `Retrieved object "${key}" from bucket "${bucket}".`,
        bucket,
        key,
        contentType: 'text',
        contentLength: content.length,
        content: contentPreview,
        truncated: content.length > maxPreviewLength,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get S3 object',
        bucket,
        key,
      };
    }
  },
});

export default getS3ObjectTool;
