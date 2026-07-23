/** Encode arbitrary JavaScript strings into an injective cache-key-safe segment. */
export function encodeCacheKeySegment(value: string): string {
  // JSON preserves lone UTF-16 surrogates as escapes. Encoding the raw string
  // with TextEncoder would collapse them to U+FFFD and make distinct JS strings
  // alias the same cache identity.
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)));
  }
  return btoa(chunks.join(""))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

/** Decode a segment emitted by {@link encodeCacheKeySegment}. */
export function decodeCacheKeySegment(encoded: string): string | null {
  if (!/^[A-Za-z0-9_-]+$/.test(encoded) || encoded.length % 4 === 1) return null;

  try {
    const base64 = encoded.replaceAll("-", "+").replaceAll("_", "/") +
      "=".repeat((4 - encoded.length % 4) % 4);
    const binary = atob(base64);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const value: unknown = JSON.parse(decoded);
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}
