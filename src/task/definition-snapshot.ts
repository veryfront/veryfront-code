import { isProxyWithoutHooks } from "#veryfront/platform/compat/error-introspection.ts";
import { captureScheduleIntegrationRequirementsConfig } from "#veryfront/schedule/validation.ts";
import { type BoundedJsonValue, snapshotBoundedJsonValue } from "#veryfront/schemas/json-value.ts";
import type { TaskDefinition } from "./types.ts";

const TASK_DEFINITION_KEYS = [
  "name",
  "description",
  "inputSchema",
  "outputSchema",
  "integrationRequirements",
  "schedulable",
  "run",
] as const;

const MAX_TASK_PROTOTYPE_DEPTH = 32;
const OBJECT_PROTOTYPE = Object.prototype;

type TaskObject = Record<PropertyKey, unknown>;

function fail(detail: string): never {
  throw new TypeError(detail);
}

function inspectTaskObject(value: unknown): TaskObject {
  if (
    typeof value !== "object" || value === null || Array.isArray(value) ||
    isProxyWithoutHooks(value)
  ) {
    fail("Task definition must be a non-Proxy object.");
  }
  return value as TaskObject;
}

function findTaskPropertyDescriptor(
  value: TaskObject,
  key: PropertyKey,
): PropertyDescriptor | undefined {
  const visited = new Set<TaskObject>();
  let owner: TaskObject | null = value;

  for (let depth = 0; owner !== null && owner !== OBJECT_PROTOTYPE; depth++) {
    if (
      depth >= MAX_TASK_PROTOTYPE_DEPTH || visited.has(owner) ||
      isProxyWithoutHooks(owner)
    ) {
      fail("Task definition has an invalid prototype chain.");
    }
    visited.add(owner);

    const descriptor = Reflect.getOwnPropertyDescriptor(owner, key);
    if (descriptor !== undefined) return descriptor;
    owner = Reflect.getPrototypeOf(owner) as TaskObject | null;
  }

  return undefined;
}

function inspectTaskDefinition(value: unknown): Map<string, unknown> {
  const task = inspectTaskObject(value);

  const fields = new Map<string, unknown>();
  for (const key of TASK_DEFINITION_KEYS) {
    const descriptor = key === "run"
      ? findTaskPropertyDescriptor(task, key)
      : Reflect.getOwnPropertyDescriptor(task, key);
    if (descriptor === undefined) continue;
    const inheritedRun = key === "run" && !Object.hasOwn(task, key);
    if (!("value" in descriptor)) {
      fail(
        inheritedRun
          ? "Task definition run must resolve to a data property."
          : `Task definition ${key} must be a data property.`,
      );
    }
    if (!inheritedRun && !descriptor.enumerable) {
      fail(`Task definition ${key} must be an own enumerable data property.`);
    }
    fields.set(key, descriptor.value);
  }
  return fields;
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
  const snapshot = snapshotBoundedJsonValue(value);
  if (
    !snapshot.success || snapshot.value === null ||
    typeof snapshot.value !== "object" || Array.isArray(snapshot.value)
  ) {
    fail(`${label} must be a bounded JSON object.`);
  }
  return freezeJsonSnapshot(snapshot.value) as Record<string, unknown>;
}

function freezeJsonSnapshot(value: BoundedJsonValue): BoundedJsonValue {
  if (typeof value !== "object" || value === null) return value;
  for (const nested of Array.isArray(value) ? value : Object.values(value)) {
    freezeJsonSnapshot(nested);
  }
  Object.freeze(value);
  return value;
}

/** Validate and capture the task metadata that crosses discovery boundaries. */
export function captureTaskDefinition(value: unknown): TaskDefinition {
  const task = inspectTaskObject(value);
  const fields = inspectTaskDefinition(task);
  const run = fields.get("run");
  if (typeof run !== "function") fail("Task definition run must be a function.");
  const runWithReceiver: TaskDefinition["run"] = (ctx) => Reflect.apply(run, task, [ctx]);

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
    "Task",
  );

  return Object.freeze({
    ...(fields.has("name") ? { name } : {}),
    ...(fields.has("description") ? { description } : {}),
    ...(fields.has("inputSchema") ? { inputSchema } : {}),
    ...(fields.has("outputSchema") ? { outputSchema } : {}),
    ...(integrationRequirements === undefined ? {} : { integrationRequirements }),
    ...(fields.has("schedulable") ? { schedulable } : {}),
    run: runWithReceiver,
  }) as TaskDefinition;
}

/** Identify structural task exports without executing accessors. */
export function isTaskDefinitionCandidate(value: unknown): value is TaskObject {
  try {
    return findTaskPropertyDescriptor(inspectTaskObject(value), "run") !== undefined;
  } catch {
    return false;
  }
}
