import type { Prompt } from "./types.ts";
import { agentLogger } from "#veryfront/utils/logger/logger.ts";
import { createError, toError } from "#veryfront/errors/veryfront-error.ts";

class PromptRegistryClass {
  private prompts = new Map<string, Prompt>();

  register(id: string, promptInstance: Prompt): void {
    if (this.prompts.has(id)) {
      agentLogger.debug(`Prompt "${id}" is already registered. Overwriting.`);
    }

    this.prompts.set(id, promptInstance);
  }

  get(id: string): Prompt | undefined {
    return this.prompts.get(id);
  }

  getContent(
    id: string,
    variables?: Record<string, unknown>,
  ): Promise<string> {
    const promptInstance = this.prompts.get(id);

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
    return new Map(this.prompts);
  }

  list(): string[] {
    return [...this.prompts.keys()];
  }

  has(id: string): boolean {
    return this.prompts.has(id);
  }

  clear(): void {
    this.prompts.clear();
  }
}

// Singleton instance using globalThis to share across module contexts
// This is necessary for esbuild-bundled API routes to access the same registry
const PROMPT_REGISTRY_KEY = "__veryfront_prompt_registry__";

type GlobalWithPromptRegistry = typeof globalThis & {
  [PROMPT_REGISTRY_KEY]?: PromptRegistryClass;
};

const globalWithRegistry = globalThis as GlobalWithPromptRegistry;

export const promptRegistry: PromptRegistryClass =
  (globalWithRegistry[PROMPT_REGISTRY_KEY] ??= new PromptRegistryClass());
