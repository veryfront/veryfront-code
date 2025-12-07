import { tool } from 'veryfront/ai';
import { z } from 'zod';
import { getAWSClient } from '../../lib/aws-client';

/**
 * Tool for listing Lambda functions
 */
export const listLambdaFunctionsTool = tool({
  name: 'list-lambda-functions',
  description: 'List all Lambda functions in your AWS account. Returns function details including name, ARN, runtime, and configuration.',
  input: z.object({
    region: z.string().optional().describe('AWS region to list Lambda functions from (e.g., "us-east-1", "eu-west-1"). Defaults to configured region.'),
  }),
  execute: async ({ region }) => {
    try {
      const client = getAWSClient();
      const functions = await client.listLambdaFunctions(region);

      if (functions.length === 0) {
        const regionMessage = region ? ` in region "${region}"` : '';
        return {
          success: true,
          message: `No Lambda functions found${regionMessage}.`,
          functions: [],
          region,
        };
      }

      return {
        success: true,
        message: `Found ${functions.length} Lambda function${functions.length === 1 ? '' : 's'}${region ? ` in region "${region}"` : ''}.`,
        functions: functions.map(func => ({
          functionName: func.functionName,
          functionArn: func.functionArn,
          runtime: func.runtime || 'N/A',
          handler: func.handler || 'N/A',
          codeSize: func.codeSize,
          lastModified: func.lastModified,
          memorySize: func.memorySize || 'N/A',
          timeout: func.timeout || 'N/A',
          description: func.description || 'No description',
        })),
        count: functions.length,
        region,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to list Lambda functions',
        functions: [],
        region,
      };
    }
  },
});

export default listLambdaFunctionsTool;
