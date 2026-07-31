/**
 * Classify an unknown thrown value without reading caller-owned properties or
 * invoking coercion hooks. The returned value is safe for structured logs.
 */
export function classifyThrownValue(value: unknown): string {
  try {
    return value instanceof Error ? "Error" : typeof value;
  } catch {
    return typeof value;
  }
}
