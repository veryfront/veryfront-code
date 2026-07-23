/** Maximum estimated size of one data-loader or static-path result. */
export const MAX_DATA_RESULT_BYTES = 8 * 1024 * 1024;

const MAX_DATA_RESULT_NODES = 100_000;
const MAX_DATA_RESULT_DEPTH = 128;
const VALUE_OVERHEAD_BYTES = 16;
const REFERENCE_BYTES = 8;

interface PendingValue {
  value: unknown;
  depth: number;
}

function boundedUtf8ByteLength(value: string, remaining: number): number {
  let bytes = 0;

  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 0x7f) {
      bytes += 1;
    } else if (code <= 0x7ff) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index++;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }

    if (bytes > remaining) return remaining + 1;
  }

  return bytes;
}

/**
 * Estimate a result without serializing it into another unbounded string.
 *
 * Cycles and shared references are counted once. Accessor and executable
 * values are rejected without invocation. Native values with explicit byte
 * lengths are charged by that length. Shared memory is rejected because it
 * cannot provide an isolated cache snapshot. Node and depth limits also bound
 * traversal work.
 */
export function isDataResultWithinLimit(
  value: unknown,
  maxBytes = MAX_DATA_RESULT_BYTES,
): boolean {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) return false;

  const pending: PendingValue[] = [{ value, depth: 0 }];
  const seen = new WeakSet<object>();
  let bytes = 0;
  let visited = 0;

  const addBytes = (amount: number): boolean => {
    if (!Number.isSafeInteger(amount) || amount < 0) return false;
    if (amount > maxBytes - bytes) return false;
    bytes += amount;
    return true;
  };

  try {
    while (pending.length > 0) {
      const current = pending.pop() as PendingValue;
      const item = current.value;

      if (++visited > MAX_DATA_RESULT_NODES || current.depth > MAX_DATA_RESULT_DEPTH) {
        return false;
      }

      if (typeof item === "string") {
        if (!addBytes(boundedUtf8ByteLength(item, maxBytes - bytes))) return false;
        continue;
      }
      if (
        item === null || item === undefined || typeof item === "boolean" ||
        typeof item === "number"
      ) {
        if (!addBytes(REFERENCE_BYTES)) return false;
        continue;
      }
      if (
        typeof item === "bigint" || typeof item === "function" ||
        typeof item === "symbol"
      ) {
        return false;
      }
      if (typeof item !== "object") return false;
      if (
        item instanceof WeakMap || item instanceof WeakSet ||
        item instanceof Promise
      ) {
        return false;
      }
      if (seen.has(item)) {
        if (!addBytes(REFERENCE_BYTES)) return false;
        continue;
      }
      seen.add(item);

      if (!addBytes(VALUE_OVERHEAD_BYTES)) return false;
      if (ArrayBuffer.isView(item)) {
        const backingBuffer = item.buffer;
        if (
          typeof SharedArrayBuffer !== "undefined" &&
          backingBuffer instanceof SharedArrayBuffer
        ) {
          return false;
        }
        if (seen.has(backingBuffer)) {
          if (!addBytes(REFERENCE_BYTES)) return false;
        } else {
          seen.add(backingBuffer);
          if (
            !addBytes(VALUE_OVERHEAD_BYTES) ||
            !addBytes(backingBuffer.byteLength)
          ) {
            return false;
          }
        }
        continue;
      }
      if (item instanceof ArrayBuffer) {
        if (!addBytes(item.byteLength)) return false;
        continue;
      }
      if (
        typeof SharedArrayBuffer !== "undefined" &&
        item instanceof SharedArrayBuffer
      ) {
        return false;
      }
      if (typeof Blob !== "undefined" && item instanceof Blob) {
        if (!addBytes(item.size)) return false;
        continue;
      }
      if (item instanceof Date) {
        if (!addBytes(REFERENCE_BYTES)) return false;
        continue;
      }
      if (item instanceof RegExp) {
        if (!addBytes(boundedUtf8ByteLength(item.source, maxBytes - bytes))) return false;
        continue;
      }
      if (item instanceof Map) {
        for (
          const [key, mapValue] of Map.prototype.entries.call(item) as Iterable<
            [unknown, unknown]
          >
        ) {
          if (pending.length > MAX_DATA_RESULT_NODES - visited - 2) return false;
          pending.push(
            { value: key, depth: current.depth + 1 },
            { value: mapValue, depth: current.depth + 1 },
          );
        }
        continue;
      }
      if (item instanceof Set) {
        for (const setValue of Set.prototype.values.call(item) as Iterable<unknown>) {
          if (pending.length >= MAX_DATA_RESULT_NODES - visited) return false;
          pending.push({ value: setValue, depth: current.depth + 1 });
        }
        continue;
      }

      const keys = Reflect.ownKeys(item);
      if (keys.length > MAX_DATA_RESULT_NODES - visited - pending.length) return false;
      for (const key of keys) {
        const keyText = typeof key === "string" ? key : key.description ?? "";
        if (!addBytes(boundedUtf8ByteLength(keyText, maxBytes - bytes))) return false;

        const descriptor = Reflect.getOwnPropertyDescriptor(item, key);
        if (!descriptor) continue;
        if ("value" in descriptor) {
          pending.push({ value: descriptor.value, depth: current.depth + 1 });
        } else {
          return false;
        }
      }
    }
  } catch {
    return false;
  }

  return true;
}
