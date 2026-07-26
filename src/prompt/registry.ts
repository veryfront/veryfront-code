import type { Prompt, PromptRenderContext } from "./types.ts";
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

class PromptRegistryInternal extends ScopedRegistryFacade<Prompt> {}

/** Project-scoped prompt registry API safe for application code. */
class PromptRegistry extends ScopedRegistryView<Prompt> {
  override register(id: string, prompt: Prompt): void {
    super.register(id, normalizePromptDefinition(id, prompt));
  }

  async getContent(
    id: string,
    variables?: Record<string, unknown>,
    context?: Readonly<PromptRenderContext>,
  ): Promise<string> {
    const registeredPrompt = this.get(id);
    if (registeredPrompt) return await registeredPrompt.getContent(variables, context);
    throw createMissingPromptError(id);
  }

  list(): string[] {
    return this.getAllIds();
  }
}

/** Framework-only prompt registry with process-wide maintenance capabilities. */
export const promptRegistryInternal = new PromptRegistryInternal(promptRegistryManager);

/** Project-scoped prompt registry value. */
export const promptRegistry = new PromptRegistry(promptRegistryInternal);
