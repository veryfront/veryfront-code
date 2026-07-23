import { INVALID_ARGUMENT } from "#veryfront/errors";
import { hasUnsafeControlCharacters } from "#veryfront/errors/text-validation.ts";
import type { TaskContext, TaskDefinition } from "./types.ts";

const MAX_TASK_NAME_LENGTH = 255;
const MAX_TASK_DESCRIPTION_LENGTH = 4_096;
const MAX_SCHEMA_DEPTH = 64;
const MAX_SCHEMA_NODES = 10_000;
const MAX_SCHEMA_CODE_UNITS = 1_048_576;
const MAX_PROTOTYPE_DEPTH = 16;

interface DataProperty {
  present: boolean;
  value: unknown;
}

function invalid(detail: string): never {
  throw INVALID_ARGUMENT.create({ detail });
}

function findDataProperty(value: object, key: string): DataProperty {
  let current: object | null = value;
  for (let depth = 0; current !== null && depth <= MAX_PROTOTYPE_DEPTH; depth++) {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(current, key);
    } catch {
      invalid(`Task definition.${key} could not be inspected safely.`);
    }
    if (descriptor) {
      if (!("value" in descriptor)) {
        invalid(`Task definition.${key} must be a data property.`);
      }
      return { present: true, value: descriptor.value };
    }
    try {
      current = Object.getPrototypeOf(current);
    } catch {
      invalid("Task definition could not be inspected safely.");
    }
  }
  if (current !== null) invalid("Task definition prototype chain is too deep.");
  return { present: false, value: undefined };
}

/** Return whether a value exposes a task-like `run` member without invoking it. */
export function hasTaskDefinitionRunMember(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  try {
    if (Array.isArray(value)) return false;
    return findDataProperty(value, "run").present;
  } catch {
    // An unreadable or excessively deep object is not a safe helper export.
    return true;
  }
}

function normalizeText(
  value: unknown,
  label: string,
  maxLength: number,
  multiline = false,
): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) {
    invalid(`${label} must contain 1 to ${maxLength} characters.`);
  }
  if (value.trim().length === 0) invalid(`${label} must not be blank.`);
  if (hasUnsafeControlCharacters(value, multiline) || value.includes("\u061C")) {
    invalid(`${label} contains unsupported control characters.`);
  }
  return value;
}

export function snapshotTaskJsonObject(
  value: unknown,
  label: string,
  freeze = true,
): Record<string, unknown> {
  const ancestors = new WeakSet<object>();
  let nodes = 0;
  let codeUnits = 0;

  const account = (depth: number): void => {
    nodes += 1;
    if (nodes > MAX_SCHEMA_NODES) invalid(`${label} exceeds the supported structure size.`);
    if (depth > MAX_SCHEMA_DEPTH) invalid(`${label} exceeds the supported nesting depth.`);
  };

  const accountText = (length: number): void => {
    codeUnits += length;
    if (codeUnits > MAX_SCHEMA_CODE_UNITS) invalid(`${label} exceeds the supported text size.`);
  };

  const inspect = <T>(operation: () => T): T => {
    try {
      return operation();
    } catch {
      invalid(`${label} must be a JSON object containing only data properties.`);
    }
  };

  const visit = (input: unknown, depth: number): unknown => {
    account(depth);
    if (input === null || typeof input === "boolean") return input;
    if (typeof input === "string") {
      accountText(input.length);
      return input;
    }
    if (typeof input === "number") {
      if (!Number.isFinite(input)) invalid(`${label} must contain finite JSON numbers.`);
      return input;
    }
    if (!input || typeof input !== "object") {
      invalid(`${label} must contain only JSON values.`);
    }

    const isArray = inspect(() => Array.isArray(input));
    const prototype = inspect(() => Object.getPrototypeOf(input));
    if (!isArray && prototype !== Object.prototype && prototype !== null) {
      invalid(`${label} must contain only plain JSON objects.`);
    }
    if (ancestors.has(input)) invalid(`${label} must not contain cycles.`);
    ancestors.add(input);

    try {
      if (isArray) {
        const lengthDescriptor = inspect(() => Object.getOwnPropertyDescriptor(input, "length"));
        const length = lengthDescriptor && "value" in lengthDescriptor
          ? lengthDescriptor.value
          : undefined;
        if (
          typeof length !== "number" || !Number.isSafeInteger(length) || length < 0 ||
          length > MAX_SCHEMA_NODES
        ) {
          invalid(`${label} contains an invalid or oversized array.`);
        }
        const keys = inspect(() => Reflect.ownKeys(input));
        for (const key of keys) {
          if (key === "length") continue;
          if (typeof key !== "string" || !/^(0|[1-9]\d*)$/.test(key)) {
            invalid(`${label} arrays must not contain extra properties.`);
          }
          const index = Number(key);
          if (!Number.isSafeInteger(index) || index < 0 || index >= length) {
            invalid(`${label} arrays must not contain extra properties.`);
          }
        }

        const snapshot = new Array<unknown>(length);
        for (let index = 0; index < length; index++) {
          const descriptor = inspect(() => Object.getOwnPropertyDescriptor(input, String(index)));
          if (!descriptor || !("value" in descriptor)) {
            invalid(`${label} arrays must be dense and contain only data properties.`);
          }
          snapshot[index] = visit(descriptor.value, depth + 1);
        }
        return freeze ? Object.freeze(snapshot) : snapshot;
      }

      const snapshot = Object.create(null) as Record<string, unknown>;
      const keys = inspect(() => Reflect.ownKeys(input));
      for (const key of keys) {
        if (typeof key !== "string") invalid(`${label} must not contain symbol properties.`);
        const descriptor = inspect(() => Object.getOwnPropertyDescriptor(input, key));
        if (!descriptor?.enumerable || !("value" in descriptor)) {
          invalid(`${label} must contain only enumerable data properties.`);
        }
        accountText(key.length);
        Object.defineProperty(snapshot, key, {
          configurable: !freeze,
          enumerable: true,
          value: visit(descriptor.value, depth + 1),
          writable: !freeze,
        });
      }
      return freeze ? Object.freeze(snapshot) : snapshot;
    } finally {
      ancestors.delete(input);
    }
  };

  const snapshot = visit(value, 0);
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    invalid(`${label} must be a JSON object.`);
  }
  return snapshot as Record<string, unknown>;
}

/** Validate and detach one task definition without invoking accessors. */
export function normalizeTaskDefinition(value: unknown): TaskDefinition {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    invalid("Task definition must be an object.");
  }

  const runProperty = findDataProperty(value, "run");
  if (!runProperty.present || typeof runProperty.value !== "function") {
    invalid("Task definition.run must be a function data property.");
  }
  const nameProperty = findDataProperty(value, "name");
  const descriptionProperty = findDataProperty(value, "description");
  const inputSchemaProperty = findDataProperty(value, "inputSchema");
  const outputSchemaProperty = findDataProperty(value, "outputSchema");
  const schedulableProperty = findDataProperty(value, "schedulable");

  const name = !nameProperty.present || nameProperty.value === undefined
    ? undefined
    : normalizeText(nameProperty.value, "Task definition.name", MAX_TASK_NAME_LENGTH);
  const description = !descriptionProperty.present || descriptionProperty.value === undefined
    ? undefined
    : normalizeText(
      descriptionProperty.value,
      "Task definition.description",
      MAX_TASK_DESCRIPTION_LENGTH,
      true,
    );
  const inputSchema = !inputSchemaProperty.present || inputSchemaProperty.value === undefined
    ? undefined
    : snapshotTaskJsonObject(inputSchemaProperty.value, "Task definition.inputSchema");
  const outputSchema = !outputSchemaProperty.present || outputSchemaProperty.value === undefined
    ? undefined
    : snapshotTaskJsonObject(outputSchemaProperty.value, "Task definition.outputSchema");
  if (
    schedulableProperty.present && schedulableProperty.value !== undefined &&
    typeof schedulableProperty.value !== "boolean"
  ) {
    invalid("Task definition.schedulable must be a boolean when provided.");
  }

  const run = runProperty.value as TaskDefinition["run"];
  const normalizedDefinition: TaskDefinition = {
    ...(name === undefined ? {} : { name }),
    ...(description === undefined ? {} : { description }),
    ...(inputSchema === undefined ? {} : { inputSchema }),
    ...(outputSchema === undefined ? {} : { outputSchema }),
    ...(schedulableProperty.value === undefined
      ? {}
      : { schedulable: schedulableProperty.value as boolean }),
    run: (ctx: TaskContext): Promise<unknown> | unknown =>
      Reflect.apply(run, normalizedDefinition, [ctx]),
  };

  return Object.freeze(normalizedDefinition);
}
