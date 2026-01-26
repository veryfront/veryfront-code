/***********************
 * Base64url encoding utilities
 ***********************/

function toBase64Url(b64: string): string {
  return b64.replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export function base64urlEncode(input: string): string {
  return toBase64Url(btoa(input));
}

export function base64urlEncodeBytes(bytes: Uint8Array): string {
  return toBase64Url(btoa(String.fromCharCode(...bytes)));
}
