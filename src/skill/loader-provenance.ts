import type { Tool } from "#veryfront/tool/types.ts";
import { createPrivateWeakStore } from "#veryfront/security/private-weak-store.ts";
import { isProxyWithoutHooks } from "#veryfront/platform/compat/error-introspection.ts";

type LoaderProvenance = { shape: "flat" | "operation"; prepareStartup?: (skillId: string) => void };
const loaders = createPrivateWeakStore<object, LoaderProvenance>();
const descriptor = Object.getOwnPropertyDescriptor;

/** Internal factory provenance, retained by aliases that preserve the executor. */
export function markFrameworkSkillLoader<T extends Tool>(
  tool: T,
  shape: "flat" | "operation",
  prepareStartup?: (skillId: string) => void,
): T {
  loaders.set(tool.execute, { shape, prepareStartup });
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

/** Establish a fresh root before startup; ordinary repeated loads stay compact. */
export function prepareFrameworkSkillBootstrap(
  value: unknown,
  skillId: string,
): Record<string, unknown> | undefined {
  const input = getFrameworkSkillBootstrapInput(value, skillId);
  if (!input || value === null || typeof value !== "object") return undefined;
  const execute = descriptor(value, "execute");
  if (execute && "value" in execute) loaders.get(execute.value)?.prepareStartup?.(skillId);
  return input;
}
