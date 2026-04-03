import type { Prompt } from "./types.ts";
import { createError, toError } from "#veryfront/errors/veryfront-error.ts";
import { ProjectScopedRegistryManager } from "#veryfront/ai/registry-manager.ts";
import { ScopedRegistryFacade } from "#veryfront/ai/registry-facade.ts";

const promptRegistryManager = new ProjectScopedRegistryManager<Prompt>("prompt");

function createMissingPromptError(id: string): Error {
  return toError(
    createError({
      type: "agent",
      message: `Prompt "${id}" not found`,
    }),
  );
}

class PromptRegistryClass extends ScopedRegistryFacade<Prompt> {
  getContent(id: string, variables?: Record<string, unknown>): Promise<string> {
    const registeredPrompt = this.get(id);
    if (registeredPrompt) return registeredPrompt.getContent(variables);
    throw createMissingPromptError(id);
  }

  list(): string[] {
    return this.getAllIds();
  }
}

export const promptRegistry = new PromptRegistryClass(promptRegistryManager);
