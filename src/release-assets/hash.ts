/**
 * Release Asset Manifest — SHA-256 helper.
 *
 * Produces lowercase hex SHA-256 digests of raw asset bytes using the Web
 * Crypto API (`crypto.subtle`), matching the content-addressing contract.
 *
 * @module release-assets/hash
 */

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Compute the lowercase hex SHA-256 digest of raw bytes. */
export async function sha256HexBytes(bytes: BufferSource): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return toHex(digest);
}

/** Compute the lowercase hex SHA-256 digest of a UTF-8 string. */
export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return toHex(digest);
}
