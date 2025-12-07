import { tool } from 'veryfront/ai';
import { z } from 'zod';
import { getAnthropicAdminClient } from '../../lib/anthropic-admin-client';

/**
 * Tool for listing all workspaces in the Anthropic organization
 */
export const listWorkspaces = tool({
  name: 'list_workspaces',
  description:
    'List all workspaces in the Anthropic organization. Workspaces allow you to organize API keys, usage, and permissions for different teams or projects.',
  parameters: z.object({}),
  execute: async () => {
    try {
      const client = getAnthropicAdminClient();
      const result = await client.listWorkspaces();

      return {
        success: true,
        workspaces: result.workspaces,
        count: result.workspaces.length,
        message: `Found ${result.workspaces.length} workspace(s)`,
      };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error ? error.message : 'Failed to list workspaces',
        workspaces: [],
      };
    }
  },
});

export default listWorkspaces;
