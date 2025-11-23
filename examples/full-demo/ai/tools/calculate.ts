/**
 * Calculator Tool - Auto-discovered as "calculate"
 */

import { tool } from 'veryfront/ai';
import { z } from 'zod';

export default tool({
  description: 'Perform mathematical calculations',
  inputSchema: z.object({
    expression: z.string().describe('Mathematical expression to evaluate (e.g., "2 + 2")'),
  }),
  execute: async ({ expression }) => {
    try {
      // Simple evaluation (in production, use a safe math parser)
      const result = eval(expression);
      return {
        expression,
        result,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      throw new Error(`Invalid expression: ${expression}`);
    }
  },
});
