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
  // Keep every non-final chunk divisible by three so concatenating separately
  // encoded chunks is identical to encoding the complete byte sequence.
  const chunkSize = 24_576;
  let base64 = "";

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length));
    base64 += btoa(String.fromCharCode(...chunk));
  }

  return toBase64Url(base64);
}
