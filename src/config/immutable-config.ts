import type { VeryfrontConfig } from "./schemas/index.ts";

function preservesOpaqueChildren(path: readonly string[]): boolean {
  return (path.length === 1 && path[0] === "extensions") ||
    (path.length === 2 && path[0] === "middleware" && path[1] === "custom") ||
    (path.length === 3 && path[0] === "tailwind" && path[1] === "theme" &&
      path[2] === "extend") ||
    (path.length === 3 && path[0] === "ai" && path[1] === "providers");
}

function cloneAndFreeze(
  value: unknown,
  path: readonly string[],
  snapshots: WeakMap<object, unknown>,
): unknown {
  if (value === null || typeof value !== "object") return value;

  const isArray = Array.isArray(value);
  const prototype = isArray ? Array.prototype : Object.getPrototypeOf(value);
  if (!isArray && prototype !== Object.prototype && prototype !== null) return value;

  const existing = snapshots.get(value);
  if (existing !== undefined) return existing;

  const preserveChildren = preservesOpaqueChildren(path);
  if (isArray) {
    const snapshot = new Array<unknown>(value.length);
    snapshots.set(value, snapshot);
    for (let index = 0; index < value.length; index++) {
      if (!(index in value)) continue;
      snapshot[index] = preserveChildren
        ? value[index]
        : cloneAndFreeze(value[index], [...path, String(index)], snapshots);
    }
    return Object.freeze(snapshot);
  }

  const source = value as Record<PropertyKey, unknown>;
  const snapshot = Object.create(prototype) as Record<PropertyKey, unknown>;
  snapshots.set(value, snapshot);
  for (const key of Reflect.ownKeys(source)) {
    const descriptor = Object.getOwnPropertyDescriptor(source, key);
    if (!descriptor?.enumerable) continue;
    const entry = Reflect.get(source, key);
    Object.defineProperty(snapshot, key, {
      configurable: true,
      enumerable: true,
      value: preserveChildren ? entry : cloneAndFreeze(entry, [...path, String(key)], snapshots),
      writable: true,
    });
  }
  return Object.freeze(snapshot);
}

/**
 * Copy and freeze schema-owned configuration containers.
 *
 * Values intentionally accepted as opaque extension points retain their
 * identity and mutability. Their containing arrays or records are copied and
 * frozen so consumers cannot replace entries in a shared snapshot.
 */
export function createImmutableConfigSnapshot<T extends Partial<VeryfrontConfig>>(
  config: T,
): T {
  return cloneAndFreeze(config, [], new WeakMap()) as T;
}
