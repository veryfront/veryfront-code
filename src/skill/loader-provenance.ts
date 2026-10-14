import { createPrivateAsyncLocalStorage } from "#veryfront/security/private-async-context.ts";
import type { Tool } from "#veryfront/tool/types.ts";
import { createPrivateWeakStore } from "#veryfront/security/private-weak-store.ts";
import { isProxyWithoutHooks } from "#veryfront/platform/compat/error-introspection.ts";

type LoaderProvenance = { shape: "flat" | "operation"; execute: object };
const startup = createPrivateAsyncLocalStorage<LoaderProvenance>();
const loaders = createPrivateWeakStore<object, LoaderProvenance>();
const descriptor = Object.getOwnPropertyDescriptor;

/** Internal factory provenance, retained by aliases that preserve the executor. */
export function markFrameworkSkillLoader<T extends Tool>(
  tool: T,
  shape: "flat" | "operation",
): T {
  loaders.set(tool.execute, { shape, execute: tool.execute });
  return tool;
}

/** Build startup input from factory provenance rather than guessing a schema. */
export function getFrameworkSkillBootstrapInput(
  value: unknown,
  skillId: string,
): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || isProxyWithoutHooks(value)) return undefined;
  const execute = descriptor(value, "execute");
  if (!execute || !("value" in execute) || typeof execute.value !== "function") return undefined;
  const provenance = loaders.get(execute.value);
  const shape = provenance?.shape;
  return shape === "flat" ? { skillId } : shape === "operation" ? { load: { skillId } } : undefined;
}

/** Preserve factory provenance only while the framework materializes its own wrapper. */
export function inheritFrameworkSkillLoader<T extends object>(source: unknown, target: T): T {
  if (source === null || typeof source !== "object" || isProxyWithoutHooks(source)) return target;
  const execute = descriptor(source, "execute");
  if (!execute || !("value" in execute) || typeof execute.value !== "function") return target;
  const provenance = loaders.get(execute.value);
  const targetExecute = descriptor(target, "execute");
  if (
    provenance && targetExecute && "value" in targetExecute &&
    typeof targetExecute.value === "function"
  ) {
    loaders.set(targetExecute.value, provenance);
  }
  return target;
}

/** Build a factory-authorized startup input without mutating shared caches. */
export function prepareFrameworkSkillBootstrap(
  value: unknown,
  skillId: string,
): Record<string, unknown> | undefined {
  return getFrameworkSkillBootstrapInput(value, skillId);
}

/** Keep startup's complete-root requirement private and scoped to this execution. */
export function runWithFrameworkSkillBootstrap<T>(value: unknown, operation: () => T): T {
  if (value === null || typeof value !== "object" || isProxyWithoutHooks(value)) {
    throw new TypeError("Invalid framework skill loader");
  }
  const execute = descriptor(value, "execute");
  const provenance = execute && "value" in execute ? loaders.get(execute.value) : undefined;
  if (!provenance) throw new TypeError("Invalid framework skill loader");
  return startup.run(provenance, operation);
}

/** Ordinary calls remain compact while startup receives the complete authorized root. */
export function isFrameworkSkillBootstrapExecution(execute: object): boolean {
  return startup.getStore()?.execute === execute;
}
