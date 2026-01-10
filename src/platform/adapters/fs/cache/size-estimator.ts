export function estimateSize(value: unknown): number {
  if (value instanceof Uint8Array) {
    return value.length;
  }

  if (typeof value === "string") {
    return value.length * 2;
  }

  if (typeof value === "object" && value !== null) {
    return JSON.stringify(value).length * 2;
  }

  return 8;
}
