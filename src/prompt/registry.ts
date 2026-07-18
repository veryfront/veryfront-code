import type { Prompt } from "./types.ts";
import { createError, toError } from "#veryfront/errors";
import { ScopedRegistryFacade } from "#veryfront/registry/scoped-registry-facade.ts";
import { ProjectScopedRegistryManager } from "#veryfront/registry/project-scoped-registry-manager.ts";

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

/** Shared prompt registry value. */
export const promptRegistry = new PromptRegistryClass(promptRegistryManager);
