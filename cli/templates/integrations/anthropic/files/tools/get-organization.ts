import { tool } from 'veryfront/tool';
import { z } from 'zod';
import { getAnthropicAdminClient } from '../../lib/anthropic-admin-client';

export const getOrganization = tool({
  id: 'get_organization',
  description:
    'Get detailed information about the Anthropic organization including name, settings, default configurations, and billing information.',
  inputSchema: z.object({}),
  execute: async () => {
    try {
      const client = getAnthropicAdminClient();
      const organization = await client.getOrganization();

      return {
        success: true,
        organization,
        message: `Retrieved organization details for ${organization.display_name}`,
      };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : 'Failed to retrieve organization details',
        organization: null,
      };
    }
  },
});

export default getOrganization;
