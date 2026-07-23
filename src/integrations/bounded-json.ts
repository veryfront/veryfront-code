/** Limits applied while validating a JSON-compatible value. */
export interface BoundedJsonValueLimits {
  /** Maximum container nesting below the root value. */
  readonly maxDepth: number;
  /** Maximum total number of containers and primitive values. */
  readonly maxNodes: number;
  /** Maximum object-key length in UTF-16 code units. */
  readonly maxKeyLength: number;
  /** Maximum string-value length in UTF-16 code units. */
  readonly maxStringLength: number;
}

function hasValidLimits(limits: BoundedJsonValueLimits): boolean {
  return Number.isInteger(limits.maxDepth) && limits.maxDepth >= 0 &&
    Number.isInteger(limits.maxNodes) && limits.maxNodes > 0 &&
    Number.isInteger(limits.maxKeyLength) && limits.maxKeyLength >= 0 &&
    Number.isInteger(limits.maxStringLength) && limits.maxStringLength >= 0;
}

function isPlainRecord(value: object): boolean {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Return whether a value has stable JSON semantics and fits the supplied limits.
 *
 * Class instances, accessors, sparse arrays, cycles, and values that JSON would
 * silently omit or coerce are rejected so validation and serialization agree.
 */
export function isBoundedJsonValue(
  value: unknown,
  limits: BoundedJsonValueLimits,
): boolean {
  if (!hasValidLimits(limits)) return false;

  const pending: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  const seen = new WeakSet<object>();
  let nodeCount = 0;

  try {
    while (pending.length > 0) {
      const current = pending.pop();
      if (!current) return false;
      nodeCount++;
      if (nodeCount > limits.maxNodes || current.depth > limits.maxDepth) return false;

      const item = current.value;
      if (
        item === null ||
        typeof item === "boolean" ||
        (typeof item === "number" && Number.isFinite(item))
      ) {
        continue;
      }
      if (typeof item === "string") {
        if (item.length > limits.maxStringLength) return false;
        continue;
      }
      if (typeof item !== "object") return false;
      if (seen.has(item)) return false;
      seen.add(item);

      if (Array.isArray(item)) {
        if (item.length > limits.maxNodes) return false;
        const ownKeys = Reflect.ownKeys(item);
        if (ownKeys.length !== item.length + 1 || ownKeys.at(-1) !== "length") return false;

        for (let index = item.length - 1; index >= 0; index--) {
          const descriptor = Object.getOwnPropertyDescriptor(item, String(index));
          if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return false;
          pending.push({ value: descriptor.value, depth: current.depth + 1 });
        }
        continue;
      }

      if (!isPlainRecord(item)) return false;
      const ownKeys = Reflect.ownKeys(item);
      if (ownKeys.length > limits.maxNodes) return false;
      for (let index = ownKeys.length - 1; index >= 0; index--) {
        const key = ownKeys[index];
        if (typeof key !== "string" || key.length > limits.maxKeyLength) return false;
        const descriptor = Object.getOwnPropertyDescriptor(item, key);
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return false;
        pending.push({ value: descriptor.value, depth: current.depth + 1 });
      }
    }
  } catch {
    return false;
  }

  return true;
}
