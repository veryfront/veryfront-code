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
const objectCreate = Object.create;
const objectDefineProperty = Object.defineProperty;
const objectFreeze = Object.freeze;
const objectValues = Object.values;
const reflectApply = Reflect.apply;
const reflectGetOwnPropertyDescriptor = Reflect.getOwnPropertyDescriptor;
const reflectGetPrototypeOf = Reflect.getPrototypeOf;

type TaskObject = Record<PropertyKey, unknown>;
type TaskFields = Partial<Record<keyof TaskDefinition, unknown>>;

function defineArrayElement<T>(target: T[], index: number, value: T): void {
  objectDefineProperty(target, index, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}

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
  const visited: TaskObject[] = [];
  let owner: TaskObject | null = value;

  for (let depth = 0; owner !== null && owner !== OBJECT_PROTOTYPE; depth++) {
    let repeated = false;
    for (let index = 0; index < depth; index++) {
      if (visited[index] === owner) {
        repeated = true;
        break;
      }
    }
    if (
      depth >= MAX_TASK_PROTOTYPE_DEPTH || repeated ||
      isProxyWithoutHooks(owner)
    ) {
      fail("Task definition has an invalid prototype chain.");
    }
    defineArrayElement(visited, depth, owner);

    const descriptor = reflectGetOwnPropertyDescriptor(owner, key);
    if (descriptor !== undefined) return descriptor;
    owner = reflectGetPrototypeOf(owner) as TaskObject | null;
  }

  return undefined;
}

function inspectTaskDefinition(value: unknown): TaskFields {
  const task = inspectTaskObject(value);

  const fields = objectCreate(null) as TaskFields;
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
    fields[key] = descriptor.value;
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
  const run = fields.run;
  if (typeof run !== "function") fail("Task definition run must be a function.");
  const runWithReceiver: TaskDefinition["run"] = (ctx) => reflectApply(run, task, [ctx]);

  const name = optionalString(fields.name, "Task definition name");
  const description = optionalString(
    fields.description,
    "Task definition description",
  );
  const inputSchema = optionalRecord(
    fields.inputSchema,
    "Task definition inputSchema",
  );
  const outputSchema = optionalRecord(
    fields.outputSchema,
    "Task definition outputSchema",
  );
  const schedulable = fields.schedulable;
  if (schedulable !== undefined && typeof schedulable !== "boolean") {
    fail("Task definition schedulable must be a boolean.");
  }
  const integrationRequirements = captureScheduleIntegrationRequirementsConfig(
    fields.integrationRequirements,
    "Task",
  );

  return objectFreeze({
    ...(hasOwn(fields, "name") ? { name } : {}),
    ...(hasOwn(fields, "description") ? { description } : {}),
    ...(hasOwn(fields, "inputSchema") ? { inputSchema } : {}),
    ...(hasOwn(fields, "outputSchema") ? { outputSchema } : {}),
    ...(integrationRequirements === undefined ? {} : { integrationRequirements }),
    ...(hasOwn(fields, "schedulable") ? { schedulable } : {}),
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
