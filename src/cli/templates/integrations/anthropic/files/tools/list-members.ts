import { tool } from 'veryfront/tool';
import { z } from 'zod';
import { getAnthropicAdminClient } from '../../lib/anthropic-admin-client';

/**
 * Tool for listing members in the Anthropic organization
 */
export const listMembers = tool({
  name: 'list_members',
  description:
    'List all members in the Anthropic organization. Returns member details including email, role, status, and activity information.',
  parameters: z.object({}),
  execute: async () => {
    try {
      const client = getAnthropicAdminClient();
      const result = await client.listMembers();

      // Group members by role and status for summary
      const membersByRole = result.members.reduce(
        (acc, member) => {
          acc[member.role] = (acc[member.role] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>
      );

      const membersByStatus = result.members.reduce(
        (acc, member) => {
          acc[member.status] = (acc[member.status] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>
      );

      const activeMembers = result.members.filter(
        member => member.status === 'active'
      );
      const pendingMembers = result.members.filter(
        member => member.status === 'pending'
      );

      return {
        success: true,
        members: result.members,
        summary: {
          total: result.members.length,
          active: activeMembers.length,
          pending: pendingMembers.length,
          by_role: membersByRole,
          by_status: membersByStatus,
        },
        message: `Found ${result.members.length} member(s) in the organization`,
      };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error ? error.message : 'Failed to list members',
        members: [],
      };
    }
  },
});

export default listMembers;
