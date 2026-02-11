import { tool } from 'veryfront/tool';
import { z } from 'zod';
import { getAWSClient } from '../../lib/aws-client';

export const listEC2InstancesTool = tool({
  id: 'list-ec2-instances',
  description:
    'List all EC2 instances in your AWS account. Returns instance details including ID, type, state, and IP addresses.',
  inputSchema: z.object({
    region: z
      .string()
      .optional()
      .describe(
        'AWS region to list instances from (e.g., "us-east-1", "eu-west-1"). Defaults to configured region.',
      ),
  }),
  execute: async ({ region }) => {
    try {
      const client = getAWSClient();
      const instances = await client.listEC2Instances(region);
      const regionMessage = region ? ` in region "${region}"` : '';

      if (instances.length === 0) {
        return {
          success: true,
          message: `No EC2 instances found${regionMessage}.`,
          instances: [],
          region,
        };
      }

      const count = instances.length;

      return {
        success: true,
        message: `Found ${count} EC2 instance${count === 1 ? '' : 's'}${regionMessage}.`,
        instances: instances.map((instance) => ({
          instanceId: instance.instanceId,
          instanceType: instance.instanceType,
          state: instance.state,
          name: instance.name ?? 'N/A',
          publicIpAddress: instance.publicIpAddress ?? 'N/A',
          privateIpAddress: instance.privateIpAddress ?? 'N/A',
          availabilityZone: instance.availabilityZone ?? 'N/A',
          launchTime: instance.launchTime?.toISOString(),
        })),
        count,
        region,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to list EC2 instances',
        instances: [],
        region,
      };
    }
  },
});

export default listEC2InstancesTool;
