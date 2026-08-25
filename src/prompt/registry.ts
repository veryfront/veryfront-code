import type { Prompt } from "./types.ts";
import { createError, toError } from "#veryfront/errors";
import {
  ScopedRegistryFacade,
  ScopedRegistryView,
} from "#veryfront/registry/scoped-registry-facade.ts";
import { ProjectScopedRegistryManager } from "#veryfront/registry/project-scoped-registry-manager.ts";
import { normalizePromptDefinition } from "./validation.ts";

const promptRegistryManager = new ProjectScopedRegistryManager<Prompt>("prompt");

function createMissingPromptError(id: string): Error {
  return toError(
    createError({
      type: "agent",
      message: `Prompt "${id}" not found`,
    }),
  );
}

class PromptRegistryInternal extends ScopedRegistryFacade<Prompt> {
  override register(id: string, prompt: Prompt): void {
    super.register(id, normalizePromptDefinition(id, prompt));
  }

  override registerShared(id: string, prompt: Prompt): void {
    super.registerShared(id, normalizePromptDefinition(id, prompt));
  }

  getContent(id: string, variables?: Record<string, unknown>): Promise<string> {
    const registeredPrompt = this.get(id);
    if (registeredPrompt) return registeredPrompt.getContent(variables);
    throw createMissingPromptError(id);
  }

  list(): string[] {
    return this.getAllIds();
  }
}

/** Framework-only prompt registry with process-wide maintenance capabilities. */
export const promptRegistryInternal = new PromptRegistryInternal(promptRegistryManager);

class PromptRegistry extends ScopedRegistryView<Prompt> {
  getContent(id: string, variables?: Record<string, unknown>): Promise<string> {
    const registeredPrompt = this.get(id);
    if (registeredPrompt) return registeredPrompt.getContent(variables);
    throw createMissingPromptError(id);
  }

  list(): string[] {
    return this.getAllIds();
  }
}

/**
 * Application-facing project-scoped prompt registry value.
 *
 * Process-wide maintenance methods remain for compatibility; framework
 * composition roots should use `promptRegistryInternal` for that behavior.
 */
export const promptRegistry = new PromptRegistry(promptRegistryInternal);
