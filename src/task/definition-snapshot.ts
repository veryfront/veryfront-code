import { isProxyWithoutHooks } from "#veryfront/platform/compat/error-introspection.ts";
import { captureScheduleIntegrationRequirementsConfig } from "#veryfront/schedule/validation.ts";
import { type BoundedJsonValue, snapshotBoundedJsonValue } from "#veryfront/schemas/json-value.ts";
import type { TaskDefinition } from "./types.ts";

const TASK_DEFINITION_KEY_COVERAGE = {
  name: true,
  description: true,
  inputSchema: true,
  outputSchema: true,
  integrationRequirements: true,
  schedulable: true,
  run: true,
} as const satisfies Record<keyof TaskDefinition, true>;
const TASK_DEFINITION_KEYS = Object.keys(
  TASK_DEFINITION_KEY_COVERAGE,
) as Array<keyof TaskDefinition>;

const MAX_TASK_PROTOTYPE_DEPTH = 32;
const arrayIsArray = Array.isArray;
const OBJECT_PROTOTYPE = Object.prototype;
const hasOwn = Object.hasOwn;
const objectFreeze = Object.freeze;
const objectValues = Object.values;
const MapConstructor = Map;
const mapGet = Map.prototype.get;
const mapHas = Map.prototype.has;
const mapSet = Map.prototype.set;
const reflectApply = Reflect.apply;
const reflectGetOwnPropertyDescriptor = Reflect.getOwnPropertyDescriptor;
const reflectGetPrototypeOf = Reflect.getPrototypeOf;
const SetConstructor = Set;
const setAdd = Set.prototype.add;
const setHas = Set.prototype.has;

type TaskObject = Record<PropertyKey, unknown>;

function fail(detail: string): never {
  throw new TypeError(detail);
}

function inspectTaskObject(value: unknown): TaskObject {
  if (
    typeof value !== "object" || value === null || arrayIsArray(value) ||
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
  const visited = new SetConstructor<TaskObject>();
  let owner: TaskObject | null = value;

  for (let depth = 0; owner !== null && owner !== OBJECT_PROTOTYPE; depth++) {
    if (
      depth >= MAX_TASK_PROTOTYPE_DEPTH || reflectApply(setHas, visited, [owner]) ||
      isProxyWithoutHooks(owner)
    ) {
      fail("Task definition has an invalid prototype chain.");
    }
    reflectApply(setAdd, visited, [owner]);

    const descriptor = reflectGetOwnPropertyDescriptor(owner, key);
    if (descriptor !== undefined) return descriptor;
    owner = reflectGetPrototypeOf(owner) as TaskObject | null;
  }

  return undefined;
}

function inspectTaskDefinition(value: unknown): Map<string, unknown> {
  const task = inspectTaskObject(value);

  const fields = new MapConstructor<string, unknown>();
  for (let index = 0; index < TASK_DEFINITION_KEYS.length; index++) {
    const key = TASK_DEFINITION_KEYS[index]!;
    const descriptor = findTaskPropertyDescriptor(task, key);
    if (descriptor === undefined) continue;
    const inherited = !hasOwn(task, key);
    if (!("value" in descriptor)) {
      fail(
        inherited
          ? `Task definition ${key} must resolve to a data property.`
          : `Task definition ${key} must be a data property.`,
      );
    }
    reflectApply(mapSet, fields, [key, descriptor.value]);
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
    typeof value !== "object" || value === null || arrayIsArray(value) ||
    isProxyWithoutHooks(value)
  ) {
    fail(`${label} must be a non-Proxy object.`);
  }
  const snapshot = snapshotBoundedJsonValue(value);
  if (
    snapshot.success && snapshot.value !== null &&
    typeof snapshot.value === "object" && !arrayIsArray(snapshot.value)
  ) {
    return freezeJsonSnapshot(snapshot.value) as Record<string, unknown>;
  }

  // Task schemas have always accepted the public Record<string, unknown>
  // contract. Arbitrary schema instances can keep parser state keyed by object
  // identity, so cloning them cannot preserve their public behavior. Retain
  // those instances unchanged; JSON schemas still take the detached, deeply
  // frozen snapshot path above.
  return value as Record<string, unknown>;
}

function freezeJsonSnapshot(value: BoundedJsonValue): BoundedJsonValue {
  if (typeof value !== "object" || value === null) return value;
  const nestedValues = arrayIsArray(value) ? value : objectValues(value);
  for (let index = 0; index < nestedValues.length; index++) {
    freezeJsonSnapshot(nestedValues[index]!);
  }
  objectFreeze(value);
  return value;
}

/** Validate and capture the task metadata that crosses discovery boundaries. */
export function captureTaskDefinition(value: unknown): TaskDefinition {
  const task = inspectTaskObject(value);
  const fields = inspectTaskDefinition(task);
  const run = reflectApply(mapGet, fields, ["run"]);
  if (typeof run !== "function") fail("Task definition run must be a function.");
  const runWithReceiver: TaskDefinition["run"] = (ctx) => reflectApply(run, task, [ctx]);

  const name = optionalString(
    reflectApply(mapGet, fields, ["name"]),
    "Task definition name",
  );
  const description = optionalString(
    reflectApply(mapGet, fields, ["description"]),
    "Task definition description",
  );
  const inputSchema = optionalRecord(
    reflectApply(mapGet, fields, ["inputSchema"]),
    "Task definition inputSchema",
  );
  const outputSchema = optionalRecord(
    reflectApply(mapGet, fields, ["outputSchema"]),
    "Task definition outputSchema",
  );
  const schedulable = reflectApply(mapGet, fields, ["schedulable"]);
  if (schedulable !== undefined && typeof schedulable !== "boolean") {
    fail("Task definition schedulable must be a boolean.");
  }
  const integrationRequirements = captureScheduleIntegrationRequirementsConfig(
    reflectApply(mapGet, fields, ["integrationRequirements"]),
    "Task",
  );

  return objectFreeze({
    ...(reflectApply(mapHas, fields, ["name"]) ? { name } : {}),
    ...(reflectApply(mapHas, fields, ["description"]) ? { description } : {}),
    ...(reflectApply(mapHas, fields, ["inputSchema"]) ? { inputSchema } : {}),
    ...(reflectApply(mapHas, fields, ["outputSchema"]) ? { outputSchema } : {}),
    ...(integrationRequirements === undefined ? {} : { integrationRequirements }),
    ...(reflectApply(mapHas, fields, ["schedulable"]) ? { schedulable } : {}),
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
