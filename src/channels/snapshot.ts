import type { JsonValue } from "#veryfront/schemas/index.ts";

const DEFAULT_MAX_JSON_DEPTH = 100;
const DEFAULT_MAX_JSON_NODES = 100_000;

export type SnapshotResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false };

export type OwnDataPropertyResult =
  | { readonly ok: true; readonly present: false }
  | { readonly ok: true; readonly present: true; readonly value: unknown }
  | { readonly ok: false };

function invalidSnapshot<T>(): SnapshotResult<T> {
  return { ok: false };
}

/** Read an own data property without invoking an accessor. */
export function readOwnDataProperty(
  input: unknown,
  key: PropertyKey,
): OwnDataPropertyResult {
  if ((typeof input !== "object" && typeof input !== "function") || input === null) {
    return { ok: false };
  }

  try {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor) return { ok: true, present: false };
    if (!("value" in descriptor)) return { ok: false };
    return { ok: true, present: true, value: descriptor.value };
  } catch {
    return { ok: false };
  }
}

/** Read a data property from a bounded prototype chain without invoking an accessor. */
export function readDataProperty(
  input: unknown,
  key: PropertyKey,
  maxPrototypeDepth = 16,
): OwnDataPropertyResult {
  if (
    (typeof input !== "object" && typeof input !== "function") || input === null ||
    !Number.isSafeInteger(maxPrototypeDepth) || maxPrototypeDepth < 0
  ) {
    return { ok: false };
  }

  const visited = new WeakSet<object>();
  let current: object | null = input;
  for (let depth = 0; current !== null && depth <= maxPrototypeDepth; depth += 1) {
    if (current === Object.prototype || current === Function.prototype) {
      return { ok: true, present: false };
    }
    if (visited.has(current)) return { ok: false };
    visited.add(current);

    try {
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (descriptor) {
        if (!("value" in descriptor)) return { ok: false };
        return { ok: true, present: true, value: descriptor.value };
      }
      current = Object.getPrototypeOf(current);
    } catch {
      return { ok: false };
    }
  }

  return current === null ? { ok: true, present: false } : { ok: false };
}

/** Snapshot a bounded dense array without using its iterator or indexed getters. */
export function snapshotDenseArray<T = unknown>(
  input: unknown,
  maxLength: number,
): SnapshotResult<T[]> {
  if (!Array.isArray(input) || !Number.isSafeInteger(maxLength) || maxLength < 0) {
    return invalidSnapshot();
  }

  const lengthProperty = readOwnDataProperty(input, "length");
  if (
    !lengthProperty.ok || !lengthProperty.present ||
    typeof lengthProperty.value !== "number" ||
    !Number.isSafeInteger(lengthProperty.value) ||
    lengthProperty.value < 0 || lengthProperty.value > maxLength
  ) {
    return invalidSnapshot();
  }

  const snapshot = new Array<T>(lengthProperty.value);
  for (let index = 0; index < lengthProperty.value; index += 1) {
    const item = readOwnDataProperty(input, String(index));
    if (!item.ok || !item.present) return invalidSnapshot();
    snapshot[index] = item.value as T;
  }
  return { ok: true, value: snapshot };
}

/**
 * Clone a bounded JSON value using property descriptors. Enumerable accessors,
 * sparse arrays, cycles, exotic objects, and unsupported primitives fail
 * closed without invoking user-defined getters or `toJSON` methods.
 */
export function snapshotJsonValue(
  input: unknown,
  options: { maxDepth?: number; maxNodes?: number } = {},
): SnapshotResult<JsonValue> {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_JSON_DEPTH;
  const maxNodes = options.maxNodes ?? DEFAULT_MAX_JSON_NODES;
  if (
    !Number.isSafeInteger(maxDepth) || maxDepth < 0 ||
    !Number.isSafeInteger(maxNodes) || maxNodes < 1
  ) {
    return invalidSnapshot();
  }

  const ancestors = new WeakSet<object>();
  let nodeCount = 0;

  const visit = (value: unknown, depth: number): SnapshotResult<JsonValue> => {
    nodeCount += 1;
    if (nodeCount > maxNodes || depth > maxDepth) return invalidSnapshot();

    if (value === null || typeof value === "string" || typeof value === "boolean") {
      return { ok: true, value };
    }
    if (typeof value === "number") {
      return Number.isFinite(value) ? { ok: true, value } : invalidSnapshot();
    }
    if (typeof value !== "object") return invalidSnapshot();

    try {
      const prototype = Object.getPrototypeOf(value);
      if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
        return invalidSnapshot();
      }
      if (ancestors.has(value)) return invalidSnapshot();
      ancestors.add(value);

      if (Array.isArray(value)) {
        const items = snapshotDenseArray(value, maxNodes - nodeCount);
        if (!items.ok) {
          ancestors.delete(value);
          return invalidSnapshot();
        }

        const snapshot: JsonValue[] = [];
        for (const item of items.value) {
          const itemSnapshot = visit(item, depth + 1);
          if (!itemSnapshot.ok) {
            ancestors.delete(value);
            return invalidSnapshot();
          }
          snapshot.push(itemSnapshot.value);
        }
        ancestors.delete(value);
        return { ok: true, value: snapshot };
      }

      const snapshot = Object.create(null) as Record<string, JsonValue>;
      for (const key of Reflect.ownKeys(value)) {
        if (typeof key !== "string") continue;
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !descriptor.enumerable) continue;
        if (!("value" in descriptor)) {
          ancestors.delete(value);
          return invalidSnapshot();
        }
        const propertySnapshot = visit(descriptor.value, depth + 1);
        if (!propertySnapshot.ok) {
          ancestors.delete(value);
          return invalidSnapshot();
        }
        Object.defineProperty(snapshot, key, {
          configurable: true,
          enumerable: true,
          value: propertySnapshot.value,
          writable: true,
        });
      }
      ancestors.delete(value);
      return { ok: true, value: snapshot };
    } catch {
      ancestors.delete(value);
      return invalidSnapshot();
    }
  };

  return visit(input, 0);
}
