/**
 * Prompt Factory
 *
 * Create prompt templates with variable interpolation.
 *
 * @module veryfront/prompt
 */

import type { Prompt, PromptConfig } from "./types.ts";
import { createError, toError } from "@veryfront/errors/veryfront-error.ts";

/**
 * Create a prompt template
 *
 * @example
 * ```typescript
 * import { prompt } from 'veryfront/prompt';
 *
 * export default prompt({
 *   description: 'Customer support prompt',
 *   content: 'You are a helpful customer support agent...',
 * });
 * ```
 *
 * @example Using variables
 * ```typescript
 * import { prompt } from 'veryfront/prompt';
 *
 * export default prompt({
 *   description: 'Greeting prompt',
 *   content: 'Hello {name}, welcome to {company}!',
 * });
 *
 * // Later: await promptInstance.getContent({ name: 'John', company: 'Acme' })
 * ```
 *
 * @example Dynamic generation
 * ```typescript
 * import { prompt } from 'veryfront/prompt';
 *
 * export default prompt({
 *   description: 'Context-aware prompt',
 *   generate: async (vars) => {
 *     const context = await fetchContext(vars.userId);
 *     return `You are helping ${context.name}...`;
 *   },
 * });
 * ```
 */
export function prompt(config: PromptConfig): Prompt {
  const id = config.id || generatePromptId();

  return {
    id,
    description: config.description,

    async getContent(
      variables?: Record<string, unknown>,
    ): Promise<string> {
      // If static content
      if (config.content) {
        return interpolateVariables(config.content, variables || {});
      }

      // If dynamic generator
      if (config.generate) {
        return await config.generate(variables || {});
      }

      throw toError(createError({
        type: "agent",
        message: `Prompt "${id}" has no content or generator`,
      }));
    },
  };
}

/**
 * Generate a unique prompt ID
 */
let promptIdCounter = 0;
function generatePromptId(): string {
  return `prompt_${Date.now()}_${promptIdCounter++}`;
}

/**
 * Interpolate variables in prompt template
 * Replaces {variableName} with actual values
 */
function interpolateVariables(
  template: string,
  variables: Record<string, unknown>,
): string {
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    const value = variables[key];
    return value !== undefined && value !== null ? String(value) : match;
  });
}
