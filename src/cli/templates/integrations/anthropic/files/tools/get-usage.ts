import { tool } from 'veryfront/tool';
import { z } from 'zod';
import { getAnthropicAdminClient } from '../../lib/anthropic-admin-client';

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
      .describe('Optional workspace ID to filter usage by specific workspace'),
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

      const totals = result.usage.reduce(
        (acc, record) => {
          acc.input += record.input_tokens;
          acc.output += record.output_tokens;
          acc.cacheCreation += record.cache_creation_tokens ?? 0;
          acc.cacheRead += record.cache_read_tokens ?? 0;
          return acc;
        },
        { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 }
      );

      return {
        success: true,
        usage: result.usage,
        summary: {
          total_cost_usd: result.total_cost_usd,
          total_input_tokens: totals.input,
          total_output_tokens: totals.output,
          total_cache_creation_tokens: totals.cacheCreation,
          total_cache_read_tokens: totals.cacheRead,
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
        error: error instanceof Error ? error.message : 'Failed to retrieve usage data',
        usage: [],
      };
    }
  },
});

export default getUsage;
