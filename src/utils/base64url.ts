/**
 * Base64url encoding utilities
 */

/**
 * Encode a string to base64url format
 * @param input - Plain string to encode
 * @returns Base64url encoded string
 */
export function base64urlEncode(input: string): string {
  const b64 = btoa(input);
  return b64.replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

/**
 * Encode bytes to base64url format
 * @param bytes - Uint8Array to encode
 * @returns Base64url encoded string
 */
export function base64urlEncodeBytes(bytes: Uint8Array): string {
  const b64 = btoa(String.fromCharCode(...bytes));
  return b64.replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
