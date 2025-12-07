import { tool } from 'veryfront/ai';
import { z } from 'zod';
import { getAnthropicAdminClient } from '../../lib/anthropic-admin-client';

/**
 * Tool for listing API keys in the Anthropic organization
 */
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
      const result = await client.listAPIKeys(workspaceId);

      // Group keys by status and type for summary
      const activeKeys = result.api_keys.filter(key => key.status === 'active');
      const revokedKeys = result.api_keys.filter(
        key => key.status === 'revoked'
      );

      const keysByType = result.api_keys.reduce(
        (acc, key) => {
          acc[key.key_type] = (acc[key.key_type] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>
      );

      return {
        success: true,
        api_keys: result.api_keys,
        summary: {
          total: result.api_keys.length,
          active: activeKeys.length,
          revoked: revokedKeys.length,
          by_type: keysByType,
          workspace_id: workspaceId,
        },
        message: workspaceId
          ? `Found ${result.api_keys.length} API key(s) for workspace ${workspaceId}`
          : `Found ${result.api_keys.length} API key(s) in the organization`,
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
