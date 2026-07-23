const REFERENCE_SIZE_BYTES = 8;

function estimateNonJsonSize(value: unknown, seen: WeakSet<object>): number {
  if (value instanceof Uint8Array) return value.byteLength;
  if (value instanceof ArrayBuffer) return value.byteLength;
  if (typeof value === "string") return value.length * 2;
  if (value === null || typeof value !== "object") return REFERENCE_SIZE_BYTES;
  if (seen.has(value)) return REFERENCE_SIZE_BYTES;

  seen.add(value);
  let size = REFERENCE_SIZE_BYTES;

  if (Array.isArray(value)) {
    for (const item of value) size += estimateNonJsonSize(item, seen);
    return size;
  }

  for (const key of Object.keys(value)) {
    size += key.length * 2;
    try {
      size += estimateNonJsonSize((value as Record<string, unknown>)[key], seen);
    } catch {
      size += REFERENCE_SIZE_BYTES;
    }
  }
  return size;
}

export function estimateSize(value: unknown): number {
  if (value instanceof Uint8Array) return value.byteLength;
  if (typeof value === "string") return value.length * 2;
  if (value == null || typeof value !== "object") return REFERENCE_SIZE_BYTES;

  try {
    const serialized = JSON.stringify(value);
    if (serialized !== undefined) return serialized.length * 2;
  } catch {
    // Cyclic and non-JSON values still need a bounded in-memory estimate.
  }

  return estimateNonJsonSize(value, new WeakSet());
}
