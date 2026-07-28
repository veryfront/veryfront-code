/**
 * Capture a fixed set of fields without invoking caller-owned accessors.
 *
 * OAuth configuration crosses long-lived and asynchronous boundaries. Reading
 * the original object again after validation would let a getter or later
 * mutation change endpoints, credentials, scopes, or handler behavior.
 */
export function snapshotOwnDataProperties<const Key extends string>(
  value: unknown,
  keys: readonly Key[],
): Partial<Record<Key, unknown>> | null {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    const prototype = Reflect.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;

    const snapshot = Object.create(null) as Partial<Record<Key, unknown>>;
    for (const key of keys) {
      const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined) continue;
      if (!("value" in descriptor)) return null;
      Object.defineProperty(snapshot, key, {
        configurable: true,
        enumerable: true,
        value: descriptor.value,
        writable: true,
      });
    }
    return snapshot;
  } catch {
    return null;
  }
}
