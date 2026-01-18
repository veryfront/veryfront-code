import { tool } from 'veryfront/tool';
import { z } from 'zod';
import { getAnthropicAdminClient } from '../../lib/anthropic-admin-client';

/**
 * Tool for retrieving API usage statistics from Anthropic
 */
export const getUsage = tool({
  name: 'get_usage',
  description:
    'Get API usage statistics for a specific date range. Returns token usage and costs broken down by date, workspace, and model. Dates must be in YYYY-MM-DD format.',
  parameters: z.object({
    startDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
      .describe('Start date for usage query (YYYY-MM-DD format, e.g., 2025-01-01)'),
    endDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
      .describe('End date for usage query (YYYY-MM-DD format, e.g., 2025-01-31)'),
    workspaceId: z
      .string()
      .optional()
      .describe(
        'Optional workspace ID to filter usage by specific workspace'
      ),
    model: z
      .string()
      .optional()
      .describe(
        'Optional model name to filter usage (e.g., claude-3-opus-20240229, claude-3-sonnet-20240229)'
      ),
    granularity: z
      .enum(['day', 'hour'])
      .default('day')
      .describe('Time granularity for usage aggregation (day or hour)'),
  }),
  execute: async ({ startDate, endDate, workspaceId, model, granularity }) => {
    try {
      const client = getAnthropicAdminClient();
      const result = await client.getUsage({
        startDate,
        endDate,
        workspaceId,
        model,
        granularity,
      });

      // Calculate summary statistics
      const totalInputTokens = result.usage.reduce(
        (sum, record) => sum + record.input_tokens,
        0
      );
      const totalOutputTokens = result.usage.reduce(
        (sum, record) => sum + record.output_tokens,
        0
      );
      const totalCacheCreationTokens = result.usage.reduce(
        (sum, record) => sum + (record.cache_creation_tokens || 0),
        0
      );
      const totalCacheReadTokens = result.usage.reduce(
        (sum, record) => sum + (record.cache_read_tokens || 0),
        0
      );

      return {
        success: true,
        usage: result.usage,
        summary: {
          total_cost_usd: result.total_cost_usd,
          total_input_tokens: totalInputTokens,
          total_output_tokens: totalOutputTokens,
          total_cache_creation_tokens: totalCacheCreationTokens,
          total_cache_read_tokens: totalCacheReadTokens,
          record_count: result.usage.length,
          date_range: {
            start: startDate,
            end: endDate,
          },
          filters: {
            workspace_id: workspaceId,
            model,
            granularity,
          },
        },
        message: `Retrieved ${result.usage.length} usage record(s) totaling $${result.total_cost_usd.toFixed(4)} USD`,
      };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error ? error.message : 'Failed to retrieve usage data',
        usage: [],
      };
    }
  },
});

export default getUsage;
