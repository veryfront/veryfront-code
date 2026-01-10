/**
 * MCP Prompt factory and utilities
 */

import type { Prompt, PromptConfig } from "../types/mcp.ts";
import { agentLogger } from "../../core/utils/logger/logger.ts";
import { createError, toError } from "../../core/errors/veryfront-error.ts";

/**
 * Create an MCP prompt template
 *
 * @example
 * ```typescript
 * import { prompt } from 'veryfront/ai';

 *
 * export default prompt({
 *   description: 'Customer support prompt',
 *   content: 'You are a helpful customer support agent...',
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

/**
 * Prompt registry
 */
class PromptRegistryClass {
  private prompts = new Map<string, Prompt>();

  /**
   * Register a prompt
   */
  register(id: string, promptInstance: Prompt): void {
    if (this.prompts.has(id)) {
      // Debug level - overwriting is expected during hot reload and re-discovery
      agentLogger.debug(`Prompt "${id}" is already registered. Overwriting.`);
    }

    this.prompts.set(id, promptInstance);
  }

  /**
   * Get a prompt by ID
   */
  get(id: string): Prompt | undefined {
    return this.prompts.get(id);
  }

  /**
   * Get prompt content by ID
   */
  async getContent(
    id: string,
    variables?: Record<string, unknown>,
  ): Promise<string> {
    const promptInstance = this.get(id);

    if (!promptInstance) {
      throw toError(createError({
        type: "agent",
        message: `Prompt "${id}" not found`,
      }));
    }

    return await promptInstance.getContent(variables);
  }

  /**
   * Get all prompts
   */
  getAll(): Map<string, Prompt> {
    return new Map(this.prompts);
  }

  /**
   * Clear all prompts
   */
  clear(): void {
    this.prompts.clear();
  }
}

// Singleton instance using globalThis to share across module contexts
// This is necessary for esbuild-bundled API routes to access the same registry
const PROMPT_REGISTRY_KEY = "__veryfront_prompt_registry__";
// deno-lint-ignore no-explicit-any
const _globalPrompt = globalThis as any;
export const promptRegistry: PromptRegistryClass = _globalPrompt[PROMPT_REGISTRY_KEY] ||=
  new PromptRegistryClass();
