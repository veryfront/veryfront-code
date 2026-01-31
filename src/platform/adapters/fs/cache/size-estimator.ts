export function estimateSize(value: unknown): number {
  if (value instanceof Uint8Array) return value.length;
  if (typeof value === "string") return value.length * 2;
  if (value == null) return 8;
  if (typeof value === "object") return JSON.stringify(value).length * 2;
  return 8;
}
