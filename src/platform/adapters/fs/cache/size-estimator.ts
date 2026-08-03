export function estimateSize(value: unknown): number {
  if (value instanceof Uint8Array) return value.length;
  if (typeof value === "string") return value.length * 2;
  if (value == null) return 8;
  if (typeof value === "object") {
    try {
      const serialized = JSON.stringify(value);
      return serialized === undefined ? Number.MAX_SAFE_INTEGER : serialized.length * 2;
    } catch {
      // The cache cannot safely persist cyclic values, BigInts, or objects
      // whose serialization hooks fail. Treat them as too large so callers
      // reject admission without weakening memory limits.
      return Number.MAX_SAFE_INTEGER;
    }
  }
  return 8;
}
