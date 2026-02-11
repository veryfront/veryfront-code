import { tool } from 'veryfront/tool';
import { z } from 'zod';
import { getAnthropicAdminClient } from '../../lib/anthropic-admin-client';

export const listMembers = tool({
  id: 'list_members',
  description:
    'List all members in the Anthropic organization. Returns member details including email, role, status, and activity information.',
  inputSchema: z.object({}),
  execute: async () => {
    try {
      const client = getAnthropicAdminClient();
      const { members } = await client.listMembers();

      const membersByRole: Record<string, number> = {};
      const membersByStatus: Record<string, number> = {};
      let active = 0;
      let pending = 0;

      for (const member of members) {
        membersByRole[member.role] = (membersByRole[member.role] ?? 0) + 1;
        membersByStatus[member.status] = (membersByStatus[member.status] ?? 0) + 1;

        if (member.status === 'active') active += 1;
        if (member.status === 'pending') pending += 1;
      }

      return {
        success: true,
        members,
        summary: {
          total: members.length,
          active,
          pending,
          by_role: membersByRole,
          by_status: membersByStatus,
        },
        message: `Found ${members.length} member(s) in the organization`,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to list members',
        members: [],
      };
    }
  },
});

export default listMembers;
