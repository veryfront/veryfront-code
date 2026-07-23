import type { Prompt, PromptRenderContext } from "./types.ts";
import { assertPromptId, snapshotPromptDefinition } from "./definition.ts";
import { createError, INVALID_ARGUMENT, toError } from "#veryfront/errors";
import { ScopedRegistryFacade } from "#veryfront/registry/scoped-registry-facade.ts";
import { ProjectScopedRegistryManager } from "#veryfront/registry/project-scoped-registry-manager.ts";

const promptRegistryManager = new ProjectScopedRegistryManager<Prompt>("prompt", {
  validateRegistration(id, existing, incoming) {
    if (existing === incoming) return;
    throw INVALID_ARGUMENT.create({
      detail: `Prompt registry already contains a different definition for "${id}"`,
    });
  },
});

function createMissingPromptError(id: string): Error {
  return toError(
    createError({
      type: "agent",
      message: `Prompt "${id}" not found`,
    }),
  );
}

class PromptRegistryClass extends ScopedRegistryFacade<Prompt> {
  override register(id: string, item: Prompt): void {
    super.register(id, snapshotPromptDefinition(item, id));
  }

  override registerShared(id: string, item: Prompt): void {
    super.registerShared(id, snapshotPromptDefinition(item, id));
  }

  /** Render one registered prompt with a bounded snapshot of caller variables. */
  getContent(
    id: string,
    variables?: Record<string, unknown>,
    context?: PromptRenderContext,
  ): Promise<string> {
    const promptId = assertPromptId(id);
    const registeredPrompt = this.get(promptId);
    if (registeredPrompt) return registeredPrompt.getContent(variables, context);
    throw createMissingPromptError(promptId);
  }

  /** List the prompt IDs visible in the active registry scope. */
  list(): string[] {
    return this.getAllIds();
  }
}

/** Shared project-scoped prompt registry. */
export const promptRegistry = new PromptRegistryClass(promptRegistryManager);
