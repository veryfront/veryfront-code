/**
 * Prompt Registry
 *
 * Global registry for prompt templates.
 *
 * @module veryfront/prompt
 */

import type { Prompt } from "./types.ts";
import { agentLogger } from "@veryfront/utils/logger/logger.ts";
import { createError, toError } from "@veryfront/errors/veryfront-error.ts";

/**
 * Prompt registry for managing prompt templates
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
   * List all prompt IDs
   */
  list(): string[] {
    return Array.from(this.prompts.keys());
  }

  /**
   * Check if a prompt exists
   */
  has(id: string): boolean {
    return this.prompts.has(id);
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
