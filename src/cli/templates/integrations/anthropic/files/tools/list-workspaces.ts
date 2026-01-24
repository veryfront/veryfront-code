import { tool } from 'veryfront/tool';
import { z } from 'zod';
import { getAnthropicAdminClient } from '../../lib/anthropic-admin-client';

export const listWorkspaces = tool({
  name: 'list_workspaces',
  description:
    'List all workspaces in the Anthropic organization. Workspaces allow you to organize API keys, usage, and permissions for different teams or projects.',
  parameters: z.object({}),
  execute: async () => {
    try {
      const client = getAnthropicAdminClient();
      const { workspaces } = await client.listWorkspaces();
      const count = workspaces.length;

      return {
        success: true,
        workspaces,
        count,
        message: `Found ${count} workspace(s)`,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to list workspaces',
        workspaces: [],
      };
    }
  },
});

export default listWorkspaces;
