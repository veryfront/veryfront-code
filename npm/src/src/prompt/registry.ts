/**
 * Prompt Registry
 *
 * Project-scoped registry for prompt templates. Each project has its own
 * isolated prompt namespace, preventing cross-project prompt access.
 *
 * @module
 */

import type { Prompt } from "./types.js";
import { createError, toError } from "../errors/veryfront-error.js";
import { ProjectScopedRegistryManager } from "../ai/registry-manager.js";

const promptManager = new ProjectScopedRegistryManager<Prompt>("prompt");

class PromptRegistryClass {
  register(id: string, promptInstance: Prompt): void {
    promptManager.register(id, promptInstance);
  }

  /**
   * Register a framework-provided prompt available to all projects.
   */
  registerShared(id: string, promptInstance: Prompt): void {
    promptManager.registerShared(id, promptInstance);
  }

  get(id: string): Prompt | undefined {
    return promptManager.get(id);
  }

  getContent(id: string, variables?: Record<string, unknown>): Promise<string> {
    const promptInstance = promptManager.get(id);

    if (!promptInstance) {
      throw toError(
        createError({
          type: "agent",
          message: `Prompt "${id}" not found`,
        }),
      );
    }

    return promptInstance.getContent(variables);
  }

  getAll(): Map<string, Prompt> {
    return promptManager.getAll();
  }

  list(): string[] {
    return promptManager.getAllIds();
  }

  has(id: string): boolean {
    return promptManager.has(id);
  }

  clear(): void {
    promptManager.clear();
  }

  /**
   * Clear everything (for testing).
   */
  clearAll(): void {
    promptManager.clearAll();
  }

  getStats() {
    return promptManager.getStats();
  }
}

// Singleton instance - maintains same interface but now project-scoped internally
export const promptRegistry = new PromptRegistryClass();
