import { tool } from 'veryfront/tool';
import { z } from 'zod';
import { getAnthropicAdminClient } from '../../lib/anthropic-admin-client';

export const listAPIKeys = tool({
  name: 'list_api_keys',
  description:
    'List all API keys for the organization or a specific workspace. Returns key metadata including name, status, type, and usage information. The actual key values are not returned for security reasons.',
  parameters: z.object({
    workspaceId: z
      .string()
      .optional()
      .describe(
        'Optional workspace ID to filter API keys by workspace. If not provided, lists all organization API keys'
      ),
  }),
  execute: async ({ workspaceId }) => {
    try {
      const client = getAnthropicAdminClient();
      const { api_keys } = await client.listAPIKeys(workspaceId);

      const active = api_keys.filter(key => key.status === 'active').length;
      const revoked = api_keys.filter(key => key.status === 'revoked').length;

      const by_type = api_keys.reduce<Record<string, number>>((acc, key) => {
        acc[key.key_type] = (acc[key.key_type] ?? 0) + 1;
        return acc;
      }, {});

      return {
        success: true,
        api_keys,
        summary: {
          total: api_keys.length,
          active,
          revoked,
          by_type,
          workspace_id: workspaceId,
        },
        message: workspaceId
          ? `Found ${api_keys.length} API key(s) for workspace ${workspaceId}`
          : `Found ${api_keys.length} API key(s) in the organization`,
      };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error ? error.message : 'Failed to list API keys',
        api_keys: [],
      };
    }
  },
});

export default listAPIKeys;
