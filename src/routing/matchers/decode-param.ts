/**
 * Decode a single URL path segment, tolerating malformed percent-encoding.
 *
 * `decodeURIComponent` throws `URIError` on invalid sequences (e.g. `%zz`).
 * For route param extraction we prefer to fall back to the raw value so a
 * malformed request yields a normal route miss / 4xx instead of crashing.
 */
export function safeDecodeParam(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch (error) {
    if (error instanceof URIError) return value;
    throw error;
  }
}
