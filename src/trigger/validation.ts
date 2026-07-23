import { TRIGGER_CONFIG_INVALID } from "#veryfront/errors";

const ID_PATTERN = /^[a-z0-9][a-z0-9._/-]*$/;
const MAX_TRIGGER_ID_LENGTH = 255;
const DEFAULT_MAX_SERIALIZABLE_DEPTH = 64;
const DEFAULT_MAX_SERIALIZABLE_NODES = 10_000;
const DEFAULT_MAX_SERIALIZABLE_CODE_UNITS = 1_048_576;
const MAX_SNAPSHOT_PATH_LENGTH = 256;

/** Resource limits applied while cloning JSON-compatible trigger input. */
export interface SerializableSnapshotOptions {
  /** Maximum nested array or object depth, up to 64. Defaults to 64. */
  maxDepth?: number;
  /** Maximum total primitive and container values, up to 10,000. Defaults to 10,000. */
  maxNodes?: number;
  /** Maximum combined string and object-key length, up to 1,048,576. Defaults to 1,048,576. */
  maxCodeUnits?: number;
}

function invalid(detail: string): never {
  throw TRIGGER_CONFIG_INVALID.create({ detail });
}

function isValidLimit(value: number, minimum: number, maximum: number): boolean {
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function normalizeSnapshotPath(value: unknown): string {
  if (
    typeof value !== "string" || value.length === 0 ||
    value.length > MAX_SNAPSHOT_PATH_LENGTH
  ) {
    invalid(`Serializable snapshot path must contain 1 to ${MAX_SNAPSHOT_PATH_LENGTH} characters.`);
  }
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) {
      invalid("Serializable snapshot path must not contain control characters.");
    }
  }
  return value;
}

function readSnapshotLimit(
  options: unknown,
  key: keyof SerializableSnapshotOptions,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (!options || typeof options !== "object") {
    invalid("Serializable snapshot options must be an object.");
  }

  let isArray: boolean;
  try {
    isArray = Array.isArray(options);
  } catch {
    invalid("Serializable snapshot options could not be inspected safely.");
  }
  if (isArray) invalid("Serializable snapshot options must be an object.");

  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(options, key);
  } catch {
    invalid("Serializable snapshot options could not be inspected safely.");
  }
  if (!descriptor) return fallback;
  if (!("value" in descriptor)) {
    invalid(`Serializable snapshot options.${key} must be a data property.`);
  }
  if (
    typeof descriptor.value !== "number" ||
    !isValidLimit(descriptor.value, minimum, maximum)
  ) {
    invalid(
      `Serializable snapshot options.${key} must be ${
        minimum === 0 ? "a non-negative" : "a positive"
      } safe integer no greater than ${maximum}.`,
    );
  }
  return descriptor.value;
}

/** Return whether a value is a canonical source-trigger identifier. */
export function isValidTriggerId(value: unknown): value is string {
  if (
    typeof value !== "string" || value.length === 0 ||
    value.length > MAX_TRIGGER_ID_LENGTH || !ID_PATTERN.test(value)
  ) {
    return false;
  }

  const segments = value.split("/");
  return segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

/** Validate a public trigger identifier and throw a typed configuration error. */
export function validateTriggerId(id: string, label: string): void {
  if (!isValidTriggerId(id)) {
    invalid(
      `${label} id must start with a lowercase letter or number, use lowercase letters, numbers, dots, underscores, slashes, or hyphens without empty or relative path segments, and contain at most ${MAX_TRIGGER_ID_LENGTH} characters.`,
    );
  }
}

function childPath(path: string, key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)
    ? `${path}.${key}`
    : `${path}[${JSON.stringify(key.slice(0, 80))}]`;
}

/**
 * Clone a bounded JSON value without invoking accessors or `toJSON` methods.
 *
 * The root value may be `undefined` so callers can represent an omitted optional
 * field. Nested `undefined` values, sparse arrays, cycles, exotic objects,
 * non-finite numbers, and enumerable symbol properties are rejected because
 * JSON serialization would otherwise lose or change their meaning.
 */
export function snapshotSerializable<T>(
  value: T,
  path = "value",
  options: SerializableSnapshotOptions = {},
): T {
  const normalizedPath = normalizeSnapshotPath(path);
  const maxDepth = readSnapshotLimit(
    options,
    "maxDepth",
    DEFAULT_MAX_SERIALIZABLE_DEPTH,
    0,
    DEFAULT_MAX_SERIALIZABLE_DEPTH,
  );
  const maxNodes = readSnapshotLimit(
    options,
    "maxNodes",
    DEFAULT_MAX_SERIALIZABLE_NODES,
    1,
    DEFAULT_MAX_SERIALIZABLE_NODES,
  );
  const maxCodeUnits = readSnapshotLimit(
    options,
    "maxCodeUnits",
    DEFAULT_MAX_SERIALIZABLE_CODE_UNITS,
    0,
    DEFAULT_MAX_SERIALIZABLE_CODE_UNITS,
  );

  const ancestors = new WeakSet<object>();
  let nodeCount = 0;
  let codeUnitCount = 0;

  const accountNode = (currentPath: string, depth: number): void => {
    if (depth > maxDepth) {
      invalid(`${currentPath} exceeds the maximum depth of ${maxDepth}.`);
    }
    nodeCount += 1;
    if (nodeCount > maxNodes) {
      invalid(`${normalizedPath} exceeds the maximum size of ${maxNodes} values.`);
    }
  };

  const accountCodeUnits = (count: number): void => {
    codeUnitCount += count;
    if (codeUnitCount > maxCodeUnits) {
      invalid(`${normalizedPath} exceeds the maximum text size of ${maxCodeUnits} characters.`);
    }
  };

  const ownDescriptor = (
    input: object,
    key: PropertyKey,
    currentPath: string,
  ): PropertyDescriptor | undefined => {
    try {
      return Object.getOwnPropertyDescriptor(input, key);
    } catch {
      invalid(`${currentPath} must be JSON-serializable.`);
    }
  };

  const ownKeys = (input: object, currentPath: string): PropertyKey[] => {
    try {
      return Reflect.ownKeys(input);
    } catch {
      invalid(`${currentPath} must be JSON-serializable.`);
    }
  };

  const visit = (input: unknown, currentPath: string, depth: number, root: boolean): unknown => {
    accountNode(currentPath, depth);

    if (input === undefined) {
      if (root) return undefined;
      invalid(`${currentPath} must be JSON-serializable.`);
    }
    if (input === null || typeof input === "boolean") return input;
    if (typeof input === "string") {
      accountCodeUnits(input.length);
      return input;
    }
    if (typeof input === "number") {
      if (!Number.isFinite(input)) invalid(`${currentPath} must be JSON-serializable.`);
      return input;
    }
    if (typeof input !== "object") {
      invalid(`${currentPath} must be JSON-serializable.`);
    }

    let prototype: object | null;
    let isArray: boolean;
    try {
      isArray = Array.isArray(input);
      prototype = Object.getPrototypeOf(input);
    } catch {
      invalid(`${currentPath} must be JSON-serializable.`);
    }
    if (!isArray && prototype !== Object.prototype && prototype !== null) {
      invalid(`${currentPath} must be JSON-serializable.`);
    }
    if (ancestors.has(input)) {
      invalid(`${currentPath} must be JSON-serializable and cannot contain cycles.`);
    }
    ancestors.add(input);

    try {
      if (isArray) {
        const lengthDescriptor = ownDescriptor(input, "length", currentPath);
        const length = lengthDescriptor && "value" in lengthDescriptor
          ? lengthDescriptor.value
          : undefined;
        if (!Number.isSafeInteger(length) || length < 0 || length > maxNodes) {
          invalid(`${currentPath} must be JSON-serializable as a bounded dense array.`);
        }

        for (const key of ownKeys(input, currentPath)) {
          if (key === "length") continue;
          if (typeof key !== "string" || !/^(?:0|[1-9][0-9]*)$/.test(key)) {
            invalid(
              `${currentPath} must be JSON-serializable as an undecorated dense array.`,
            );
          }
          const index = Number(key);
          if (!Number.isSafeInteger(index) || index < 0 || index >= length) {
            invalid(
              `${currentPath} must be JSON-serializable as an undecorated dense array.`,
            );
          }
        }

        const snapshot: unknown[] = new Array(length);
        for (let index = 0; index < length; index++) {
          const descriptor = ownDescriptor(input, String(index), currentPath);
          if (!descriptor || !("value" in descriptor)) {
            invalid(
              `${currentPath} must be JSON-serializable as a bounded dense array without accessors.`,
            );
          }
          snapshot[index] = visit(
            descriptor.value,
            `${currentPath}[${index}]`,
            depth + 1,
            false,
          );
        }
        return snapshot;
      }

      const keys = ownKeys(input, currentPath);
      const snapshot = Object.create(null) as Record<string, unknown>;
      for (const key of keys) {
        const descriptor = ownDescriptor(input, key, currentPath);
        if (!descriptor || !descriptor.enumerable) continue;
        if (typeof key !== "string" || !("value" in descriptor)) {
          invalid(`${currentPath} must be JSON-serializable and contain only data properties.`);
        }
        accountCodeUnits(key.length);
        Object.defineProperty(snapshot, key, {
          configurable: true,
          enumerable: true,
          value: visit(descriptor.value, childPath(currentPath, key), depth + 1, false),
          writable: true,
        });
      }
      return snapshot;
    } finally {
      ancestors.delete(input);
    }
  };

  return visit(value, normalizedPath, 0, true) as T;
}

/** Assert that a value can be represented exactly as bounded JSON data. */
export function assertSerializable(value: unknown, path = "value"): void {
  snapshotSerializable(value, path);
}
