/**
 * Calculator Tool - Auto-discovered as "calculate"
 */

import { tool } from 'veryfront/tool';
import { z } from 'zod';

/**
 * Safe math expression evaluator.
 * Only allows numbers, basic operators, parentheses, and whitespace.
 * Prevents code injection by validating input before evaluation.
 */
function safeMathEval(expression: string): number {
  // Whitelist: only digits, operators, parentheses, decimal points, whitespace
  const sanitized = expression.replace(/\s+/g, '');
  const safePattern = /^[\d+\-*/().]+$/;

  if (!safePattern.test(sanitized)) {
    throw new Error('Expression contains invalid characters');
  }

  // Additional safety: check for balanced parentheses
  let depth = 0;
  for (const char of sanitized) {
    if (char === '(') depth++;
    if (char === ')') depth--;
    if (depth < 0) throw new Error('Unbalanced parentheses');
  }
  if (depth !== 0) throw new Error('Unbalanced parentheses');

  // Use Function constructor with validated input (safer than eval)
  // The expression is guaranteed to only contain math characters at this point
  try {
    const fn = new Function(`return (${sanitized})`);
    const result = fn();
    if (typeof result !== 'number' || !isFinite(result)) {
      throw new Error('Result is not a valid number');
    }
    return result;
  } catch {
    throw new Error('Failed to evaluate expression');
  }
}

export default tool({
  description: 'Perform mathematical calculations',
  inputSchema: z.object({
    expression: z.string().describe('Mathematical expression to evaluate (e.g., "2 + 2")'),
  }),
  execute: async ({ expression }) => {
    try {
      const result = safeMathEval(expression);
      return {
        expression,
        result,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      throw new Error(`Invalid expression: ${expression} - ${(error as Error).message}`);
    }
  },
});
