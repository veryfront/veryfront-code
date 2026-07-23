/***********************
 * Base64url encoding utilities
 ***********************/

function toBase64Url(b64: string): string {
  return b64.replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export function base64urlEncode(input: string): string {
  return base64urlEncodeBytes(new TextEncoder().encode(input));
}

export function base64urlEncodeBytes(bytes: Uint8Array): string {
  // Keep each spread below engine argument limits. The chunk size is divisible
  // by three, so only the final base64 chunk can contain padding.
  const chunkSize = 24 * 1024;
  let encoded = "";
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    encoded += btoa(String.fromCharCode(...bytes.subarray(offset, offset + chunkSize)));
  }
  return toBase64Url(encoded);
}

/** Decode canonical unpadded base64url into uninterpreted bytes. */
export function base64urlDecodeBytes(encoded: string): Uint8Array | undefined {
  if (!/^[A-Za-z0-9_-]*$/.test(encoded) || encoded.length % 4 === 1) return undefined;

  const base64 = encoded.replaceAll("-", "+").replaceAll("_", "/") +
    "=".repeat((4 - (encoded.length % 4)) % 4);

  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) {
      bytes[index] = binary.charCodeAt(index);
    }
    if (base64urlEncodeBytes(bytes) !== encoded) return undefined;
    return bytes;
  } catch {
    return undefined;
  }
}
