import { isProxyWithoutHooks } from "#veryfront/platform/compat/error-introspection.ts";
import { captureScheduleIntegrationRequirementsConfig } from "#veryfront/schedule/validation.ts";
import type { TaskDefinition } from "./types.ts";

const apply = Reflect.apply;
const getOwnPropertyDescriptor = Reflect.getOwnPropertyDescriptor;
const getPrototypeOf = Reflect.getPrototypeOf;
const objectPrototype = Object.prototype;
const MAX_TASK_PROTOTYPE_CHAIN_DEPTH = 100;

const TASK_DEFINITION_KEYS = [
  "name",
  "description",
  "inputSchema",
  "outputSchema",
  "integrationRequirements",
  "schedulable",
  "run",
] as const;

function fail(detail: string): never {
  throw new TypeError(detail);
}

function findTaskPropertyDescriptor(
  value: object,
  key: string,
): PropertyDescriptor | undefined {
  let current: object | null = value;
  for (
    let depth = 0;
    current !== null && current !== objectPrototype && depth < MAX_TASK_PROTOTYPE_CHAIN_DEPTH;
    depth++
  ) {
    if (isProxyWithoutHooks(current)) {
      fail("Task definition must not use Proxy objects in its prototype chain.");
    }

    const descriptor = getOwnPropertyDescriptor(current, key);
    if (descriptor !== undefined) return descriptor;
    current = getPrototypeOf(current);
  }
  if (current !== null && current !== objectPrototype) {
    fail("Task definition prototype chain is too deep.");
  }
  return undefined;
}

function inspectTaskDefinition(
  value: unknown,
): { source: object; fields: Map<string, unknown> } {
  if (
    typeof value !== "object" || value === null || Array.isArray(value) ||
    isProxyWithoutHooks(value)
  ) {
    fail("Task definition must be a non-Proxy object.");
  }

  const fields = new Map<string, unknown>();
  for (const key of TASK_DEFINITION_KEYS) {
    const descriptor = findTaskPropertyDescriptor(value, key);
    if (descriptor === undefined) continue;
    if (!("value" in descriptor)) {
      fail(`Task definition ${key} must be a data property.`);
    }
    fields.set(key, descriptor.value);
  }
  return { source: value, fields };
}

function optionalString(value: unknown, label: string): string | undefined {
  if (value !== undefined && typeof value !== "string") {
    fail(`${label} must be a string.`);
  }
  return value;
}

function optionalRecord(
  value: unknown,
  label: string,
): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== "object" || value === null || Array.isArray(value) ||
    isProxyWithoutHooks(value)
  ) {
    fail(`${label} must be a non-Proxy object.`);
  }
  return value as Record<string, unknown>;
}

/** Validate and capture the task metadata that crosses discovery boundaries. */
export function captureTaskDefinition(value: unknown): TaskDefinition {
  const { source, fields } = inspectTaskDefinition(value);
  const run = fields.get("run");
  if (typeof run !== "function") fail("Task definition run must be a function.");

  const name = optionalString(fields.get("name"), "Task definition name");
  const description = optionalString(
    fields.get("description"),
    "Task definition description",
  );
  const inputSchema = optionalRecord(
    fields.get("inputSchema"),
    "Task definition inputSchema",
  );
  const outputSchema = optionalRecord(
    fields.get("outputSchema"),
    "Task definition outputSchema",
  );
  const schedulable = fields.get("schedulable");
  if (schedulable !== undefined && typeof schedulable !== "boolean") {
    fail("Task definition schedulable must be a boolean.");
  }
  const integrationRequirements = captureScheduleIntegrationRequirementsConfig(
    fields.get("integrationRequirements"),
  );
  const invokeRun: TaskDefinition["run"] = (context) => apply(run, source, [context]);

  return Object.freeze({
    ...(fields.has("name") ? { name } : {}),
    ...(fields.has("description") ? { description } : {}),
    ...(fields.has("inputSchema") ? { inputSchema } : {}),
    ...(fields.has("outputSchema") ? { outputSchema } : {}),
    ...(integrationRequirements === undefined ? {} : { integrationRequirements }),
    ...(fields.has("schedulable") ? { schedulable } : {}),
    run: invokeRun,
  }) as TaskDefinition;
}

/** Identify structural task exports without executing accessors. */
export function isTaskDefinitionCandidate(value: unknown): value is object {
  if (
    typeof value !== "object" || value === null || Array.isArray(value) ||
    isProxyWithoutHooks(value)
  ) {
    return false;
  }

  try {
    return findTaskPropertyDescriptor(value, "run") !== undefined;
  } catch {
    return false;
  }
}
