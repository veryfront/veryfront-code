import {
  getUTF8ByteLength,
  MAX_HTML_HYDRATION_DATA_BYTES,
  MAX_HTML_HYDRATION_JSON_CONTAINER_ENTRIES,
  MAX_HTML_HYDRATION_JSON_DEPTH,
  MAX_HTML_HYDRATION_JSON_TOTAL_ENTRIES,
} from "./limits.ts";

type JSONPrimitive = null | boolean | number | string;
type JSONValue = JSONPrimitive | JSONValue[] | { [key: string]: JSONValue };

interface SnapshotState {
  readonly ancestors: WeakSet<object>;
  entries: number;
  stringBytes: number;
}

function inspectionError(label: string): TypeError {
  return new TypeError(`${label} cannot be inspected`);
}

function consumeEntries(state: SnapshotState, count: number, label: string): void {
  if (
    !Number.isSafeInteger(count) || count < 0 ||
    count > MAX_HTML_HYDRATION_JSON_CONTAINER_ENTRIES ||
    state.entries > MAX_HTML_HYDRATION_JSON_TOTAL_ENTRIES - count
  ) {
    throw new TypeError(`${label} exceeds the entry limit`);
  }
  state.entries += count;
}

function consumeString(state: SnapshotState, value: string, label: string): void {
  const remaining = MAX_HTML_HYDRATION_DATA_BYTES - state.stringBytes;
  if (value.length > remaining) throw new TypeError(`${label} exceeds the size limit`);
  const bytes = getUTF8ByteLength(value);
  if (bytes > remaining) throw new TypeError(`${label} exceeds the size limit`);
  state.stringBytes += bytes;
}

function inspectPrototype(value: object, label: string): object | null {
  try {
    return Object.getPrototypeOf(value);
  } catch {
    throw inspectionError(label);
  }
}

function inspectKeys(value: object, label: string): PropertyKey[] {
  try {
    return Reflect.ownKeys(value);
  } catch {
    throw inspectionError(label);
  }
}

function inspectDescriptor(
  value: object,
  key: PropertyKey,
  label: string,
): PropertyDescriptor {
  try {
    const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
    if (!descriptor) throw inspectionError(label);
    return descriptor;
  } catch (error) {
    if (error instanceof TypeError && error.message === `${label} cannot be inspected`) {
      throw error;
    }
    throw inspectionError(label);
  }
}

function snapshotArray(
  value: unknown[],
  label: string,
  depth: number,
  state: SnapshotState,
): JSONValue[] {
  const lengthDescriptor = inspectDescriptor(value, "length", label);
  const length = lengthDescriptor.value;
  if (!Number.isSafeInteger(length) || length < 0) throw inspectionError(label);
  consumeEntries(state, length, label);

  const itemDescriptors: Array<PropertyDescriptor | undefined> = new Array(length);
  for (const key of inspectKeys(value, label)) {
    if (key === "length") continue;
    const descriptor = inspectDescriptor(value, key, label);
    if (typeof key === "symbol") {
      if (descriptor.enumerable) {
        throw new TypeError(`${label} must contain only JSON-serializable values`);
      }
      continue;
    }

    const index = Number(key);
    if (
      Number.isSafeInteger(index) && index >= 0 && index < length &&
      String(index) === key
    ) {
      itemDescriptors[index] = descriptor;
      continue;
    }
    if (descriptor.enumerable) {
      throw new TypeError(`${label} must contain only JSON-serializable values`);
    }
  }

  const snapshot: JSONValue[] = new Array(length);
  for (let index = 0; index < length; index++) {
    const descriptor = itemDescriptors[index];
    if (!descriptor) {
      throw new TypeError(`${label} must not contain sparse arrays`);
    }
    if (descriptor.get || descriptor.set || !("value" in descriptor)) {
      throw new TypeError(`${label} must not contain accessor properties`);
    }
    snapshot[index] = snapshotValue(descriptor.value, label, depth + 1, state);
  }
  return snapshot;
}

function snapshotRecord(
  value: Record<PropertyKey, unknown>,
  label: string,
  depth: number,
  state: SnapshotState,
): { [key: string]: JSONValue } {
  const prototype = inspectPrototype(value, label);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must contain only plain JSON objects`);
  }

  const entries: Array<[string, PropertyDescriptor]> = [];
  for (const key of inspectKeys(value, label)) {
    const descriptor = inspectDescriptor(value, key, label);
    if (!descriptor.enumerable) continue;
    if (typeof key !== "string") {
      throw new TypeError(`${label} must contain only JSON-serializable values`);
    }
    if (descriptor.get || descriptor.set || !("value" in descriptor)) {
      throw new TypeError(`${label} must not contain accessor properties`);
    }
    entries.push([key, descriptor]);
  }
  consumeEntries(state, entries.length, label);

  const snapshot: { [key: string]: JSONValue } = Object.create(null);
  for (const [key, descriptor] of entries) {
    consumeString(state, key, label);
    Object.defineProperty(snapshot, key, {
      configurable: true,
      enumerable: true,
      value: snapshotValue(descriptor.value, label, depth + 1, state),
      writable: true,
    });
  }
  return snapshot;
}

function snapshotValue(
  value: unknown,
  label: string,
  depth: number,
  state: SnapshotState,
): JSONValue {
  if (depth > MAX_HTML_HYDRATION_JSON_DEPTH) {
    throw new TypeError(`${label} exceeds the depth limit`);
  }
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    consumeString(state, value, label);
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(`${label} must contain only JSON-serializable values`);
    }
    return value;
  }
  if (typeof value !== "object") {
    throw new TypeError(`${label} must contain only JSON-serializable values`);
  }

  const prototype = inspectPrototype(value, label);
  if (prototype === Date.prototype) {
    let time: number;
    try {
      time = Date.prototype.getTime.call(value);
    } catch {
      throw inspectionError(label);
    }
    if (!Number.isFinite(time)) throw new TypeError(`${label} contains an invalid date`);
    const serialized = Date.prototype.toISOString.call(value);
    consumeString(state, serialized, label);
    return serialized;
  }

  if (state.ancestors.has(value)) throw new TypeError(`${label} must not contain cycles`);
  state.ancestors.add(value);
  try {
    let isArray: boolean;
    try {
      isArray = Array.isArray(value);
    } catch {
      throw inspectionError(label);
    }
    return isArray
      ? snapshotArray(value as unknown[], label, depth, state)
      : snapshotRecord(value as Record<PropertyKey, unknown>, label, depth, state);
  } finally {
    state.ancestors.delete(value);
  }
}

export interface HydrationJSONSnapshotter {
  record(value: unknown, label: string): Record<string, unknown>;
  array(value: unknown, label: string): unknown[];
}

/** Copy one plain record without dereferencing accessors or recursively cloning values. */
export function snapshotPlainDataRecord(
  value: unknown,
  label: string,
  maxEntries = MAX_HTML_HYDRATION_JSON_CONTAINER_ENTRIES,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  const prototype = inspectPrototype(value, label);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must be a plain object`);
  }

  const entries: Array<[string, unknown]> = [];
  for (const key of inspectKeys(value, label)) {
    const descriptor = inspectDescriptor(value, key, label);
    if (!descriptor.enumerable) continue;
    if (typeof key !== "string" || descriptor.get || descriptor.set || !("value" in descriptor)) {
      throw new TypeError(`${label} must not contain accessor properties`);
    }
    entries.push([key, descriptor.value]);
    if (entries.length > maxEntries) throw new TypeError(`${label} exceeds the entry limit`);
  }

  const snapshot: Record<string, unknown> = Object.create(null);
  for (const [key, entry] of entries) {
    Object.defineProperty(snapshot, key, {
      configurable: true,
      enumerable: true,
      value: entry,
      writable: true,
    });
  }
  return snapshot;
}

/** Copy one dense array without dereferencing accessors or recursively cloning values. */
export function snapshotPlainDataArray(
  value: unknown,
  label: string,
  maxEntries = MAX_HTML_HYDRATION_JSON_CONTAINER_ENTRIES,
): unknown[] {
  let isArray: boolean;
  try {
    isArray = Array.isArray(value);
  } catch {
    throw inspectionError(label);
  }
  if (!isArray) throw new TypeError(`${label} must be an array`);

  const length = inspectDescriptor(value as object, "length", label).value;
  if (!Number.isSafeInteger(length) || length < 0) throw inspectionError(label);
  if (length > maxEntries) throw new TypeError(`${label} exceeds the entry limit`);

  const descriptors: Array<PropertyDescriptor | undefined> = new Array(length);
  for (const key of inspectKeys(value as object, label)) {
    if (key === "length") continue;
    const descriptor = inspectDescriptor(value as object, key, label);
    if (typeof key === "symbol") {
      if (descriptor.enumerable) {
        throw new TypeError(`${label} must contain only indexed entries`);
      }
      continue;
    }
    const index = Number(key);
    if (Number.isSafeInteger(index) && index >= 0 && index < length && String(index) === key) {
      descriptors[index] = descriptor;
      continue;
    }
    if (descriptor.enumerable) {
      throw new TypeError(`${label} must contain only indexed entries`);
    }
  }

  const snapshot: unknown[] = [];
  for (let index = 0; index < length; index++) {
    const descriptor = descriptors[index];
    if (!descriptor) throw new TypeError(`${label} must not contain sparse arrays`);
    if (descriptor.get || descriptor.set || !("value" in descriptor)) {
      throw new TypeError(`${label} must not contain accessor properties`);
    }
    snapshot.push(descriptor.value);
  }
  return snapshot;
}

/** Copy JSON data without executing getters or user-defined `toJSON` hooks. */
export function createHydrationJSONSnapshotter(): HydrationJSONSnapshotter {
  const state: SnapshotState = {
    ancestors: new WeakSet(),
    entries: 0,
    stringBytes: 0,
  };
  return {
    record(value, label) {
      const snapshot = snapshotValue(value, label, 0, state);
      if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
        throw new TypeError(`${label} must be an object`);
      }
      return snapshot;
    },
    array(value, label) {
      const snapshot = snapshotValue(value, label, 0, state);
      if (!Array.isArray(snapshot)) throw new TypeError(`${label} must be an array`);
      return snapshot;
    },
  };
}
