import {
  type BoundedJsonPathSegment,
  type BoundedJsonValue,
  snapshotBoundedJsonValue,
} from "#veryfront/schemas/json-value.ts";
import { isProxyWithoutHooks } from "#veryfront/platform/compat/error-introspection.ts";

const HTML_JSON_MAX_DEPTH = 128;
const HTML_JSON_MAX_NODES = 100_000;
const OMIT_JSON_PROPERTY = Symbol("omit-json-property");

interface JsonRecordSnapshotOptions {
  accessorError?: string;
  maxProperties?: number;
  omitKeys?: ReadonlySet<string>;
  projectValues?: Readonly<Record<string, (value: unknown) => unknown>>;
}

class InvalidHTMLJsonSnapshot {
  constructor(readonly path: readonly BoundedJsonPathSegment[]) {}
}

function formatSnapshotPath(path: readonly BoundedJsonPathSegment[]): string {
  if (path.length === 0) return "";
  return ` at ${path.map((part) => typeof part === "number" ? `[${part}]` : part).join(".")}`;
}

function failSnapshot(path: readonly BoundedJsonPathSegment[]): never {
  throw new InvalidHTMLJsonSnapshot(path);
}

function snapshotDate(
  value: object,
  path: readonly BoundedJsonPathSegment[],
): string | null {
  if (Reflect.getPrototypeOf(value) !== Date.prototype || Reflect.ownKeys(value).length !== 0) {
    return failSnapshot(path);
  }
  const timestamp = Date.prototype.getTime.call(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function snapshotHTMLJsonGraph(
  value: unknown,
  state: { active: Set<object>; nodes: number },
  path: readonly BoundedJsonPathSegment[],
  depth: number,
  arrayElement = false,
): BoundedJsonValue | typeof OMIT_JSON_PROPERTY {
  if (depth > HTML_JSON_MAX_DEPTH || ++state.nodes > HTML_JSON_MAX_NODES) {
    return failSnapshot(path);
  }
  if (value === undefined) return arrayElement ? null : OMIT_JSON_PROPERTY;
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : failSnapshot(path);
  }
  if (
    typeof value !== "object" ||
    isProxyWithoutHooks(value) ||
    state.active.has(value)
  ) {
    return failSnapshot(path);
  }

  const prototype = Reflect.getPrototypeOf(value);
  if (prototype === Date.prototype) return snapshotDate(value, path);

  if (Array.isArray(value)) {
    const ownKeys = Reflect.ownKeys(value);
    const lengthDescriptor = Reflect.getOwnPropertyDescriptor(value, "length");
    const length = lengthDescriptor && "value" in lengthDescriptor
      ? lengthDescriptor.value
      : undefined;
    if (
      typeof length !== "number" ||
      !Number.isSafeInteger(length) ||
      length < 0 ||
      length > HTML_JSON_MAX_NODES ||
      ownKeys.some((key) => typeof key === "symbol") ||
      ownKeys.length !== length + 1 ||
      !ownKeys.includes("length")
    ) {
      return failSnapshot(path);
    }

    const snapshot: BoundedJsonValue[] = new Array(length);
    state.active.add(value);
    try {
      for (let index = 0; index < length; index++) {
        const descriptor = Reflect.getOwnPropertyDescriptor(value, String(index));
        const childPath = [...path, index];
        if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
          return failSnapshot(childPath);
        }
        snapshot[index] = snapshotHTMLJsonGraph(
          descriptor.value,
          state,
          childPath,
          depth + 1,
          true,
        ) as BoundedJsonValue;
      }
    } finally {
      state.active.delete(value);
    }
    return snapshot;
  }

  if (prototype !== Object.prototype && prototype !== null) {
    return failSnapshot(path);
  }

  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length > HTML_JSON_MAX_NODES ||
    ownKeys.some((key) => typeof key === "symbol")
  ) {
    return failSnapshot(path);
  }

  const snapshot = Object.create(null) as Record<string, BoundedJsonValue>;
  state.active.add(value);
  try {
    for (const key of ownKeys as string[]) {
      const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
      const childPath = [...path, key];
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
        return failSnapshot(childPath);
      }
      const child = snapshotHTMLJsonGraph(
        descriptor.value,
        state,
        childPath,
        depth + 1,
      );
      if (child === OMIT_JSON_PROPERTY) continue;
      Object.defineProperty(snapshot, key, {
        configurable: true,
        enumerable: true,
        value: child,
        writable: true,
      });
    }
  } finally {
    state.active.delete(value);
  }
  return snapshot;
}

export function assertHTMLJsonValueIsNotProxy(
  value: unknown,
  label: string,
): void {
  if (isProxyWithoutHooks(value)) {
    throw new TypeError(`${label} must not contain Proxy values`);
  }
}

/**
 * Captures a bounded data-only JSON graph using own descriptors.
 *
 * Callers receive a detached graph and never consume the inspected input
 * again. Throwing or inconsistent reflective traps fail closed. Exact built-in
 * `Date` values are the sole domain-type exception and become canonical ISO
 * strings without consulting caller-overridable methods.
 */
export function snapshotHTMLJsonValue<T>(value: T, label: string): T {
  let normalized: BoundedJsonValue;
  try {
    const candidate = snapshotHTMLJsonGraph(
      value,
      { active: new Set(), nodes: 0 },
      [],
      0,
    );
    if (candidate === OMIT_JSON_PROPERTY) failSnapshot([]);
    normalized = candidate;
  } catch (error) {
    const path = error instanceof InvalidHTMLJsonSnapshot ? error.path : [];
    throw new TypeError(
      `${label} must contain only bounded own JSON data${formatSnapshotPath(path)}`,
    );
  }

  const snapshot = snapshotBoundedJsonValue(normalized);
  if (!snapshot.success) {
    throw new TypeError(
      `${label} must contain only bounded own JSON data${formatSnapshotPath(snapshot.path)}`,
    );
  }
  return snapshot.value as T;
}

/**
 * Captures a plain top-level record while preserving JSON's omission of
 * top-level `undefined` values. Selected non-JSON control fields may be
 * omitted and handled separately by a caller before the remaining graph is
 * passed through the bounded deep snapshot.
 */
export function snapshotHTMLJsonRecord<T extends object>(
  value: T,
  label: string,
  options: JsonRecordSnapshotOptions = {},
): T {
  assertHTMLJsonValueIsNotProxy(value, label);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be a plain object`);
  }

  let prototype: object | null;
  let keys: PropertyKey[];
  try {
    prototype = Reflect.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch {
    throw new TypeError(`${label} cannot be inspected`);
  }
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must be a plain object`);
  }
  if (keys.length > (options.maxProperties ?? 256)) {
    throw new TypeError(`${label} exceeds the field limit`);
  }

  const projection = Object.create(null) as Record<string, unknown>;
  for (const key of keys) {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Reflect.getOwnPropertyDescriptor(value, key);
    } catch {
      throw new TypeError(`${label} cannot be inspected`);
    }
    if (!descriptor?.enumerable) continue;
    if (
      typeof key !== "string" || descriptor.get || descriptor.set ||
      !("value" in descriptor)
    ) {
      throw new TypeError(options.accessorError ?? `${label} cannot be inspected`);
    }
    if (options.omitKeys?.has(key) || descriptor.value === undefined) continue;
    const projectedValue = options.projectValues?.[key]
      ? options.projectValues[key](descriptor.value)
      : descriptor.value;
    Object.defineProperty(projection, key, {
      configurable: true,
      enumerable: true,
      value: projectedValue,
      writable: true,
    });
  }

  return snapshotHTMLJsonValue(projection, label) as T;
}
