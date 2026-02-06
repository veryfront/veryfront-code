import type { Prompt } from "./types.ts";
import { createError, toError } from "#veryfront/errors/veryfront-error.ts";
import { ProjectScopedRegistryManager } from "#veryfront/ai/registry-manager.ts";
import { ScopedRegistryFacade } from "#veryfront/ai/registry-facade.ts";

const promptManager = new ProjectScopedRegistryManager<Prompt>("prompt");

class PromptRegistryClass extends ScopedRegistryFacade<Prompt> {
  getContent(id: string, variables?: Record<string, unknown>): Promise<string> {
    const promptInstance = this.get(id);
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

  list(): string[] {
    return this.getAllIds();
  }
}

export const promptRegistry = new PromptRegistryClass(promptManager);
