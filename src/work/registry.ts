import type { WorkDefinition } from "./types.ts";
import { createError, toError } from "#veryfront/errors/veryfront-error.ts";
import { ProjectScopedRegistryManager } from "#veryfront/registry/project-scoped-registry-manager.ts";
import { ScopedRegistryFacade } from "#veryfront/registry/scoped-registry-facade.ts";

const workRegistryManager = new ProjectScopedRegistryManager<WorkDefinition>("work");

function createMissingWorkError(id: string): Error {
  return toError(
    createError({
      type: "agent",
      message: `Work "${id}" not found`,
    }),
  );
}

class WorkRegistryClass extends ScopedRegistryFacade<WorkDefinition> {
  getRequired(id: string): WorkDefinition {
    const registeredWork = this.get(id);
    if (registeredWork) return registeredWork;
    throw createMissingWorkError(id);
  }

  list(): string[] {
    return this.getAllIds();
  }
}

/** Shared Work registry value. */
export const workRegistry = new WorkRegistryClass(workRegistryManager);
