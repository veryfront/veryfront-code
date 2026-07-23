/***********************
 * Base64 / base64url encoding utilities
 ***********************/

import type { Buffer } from "node:buffer";

function toBase64Url(b64: string): string {
  return b64.replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

/** Encode a UTF-8 string as standard base64 (handles non-Latin1 input). */
export function encodeBase64(value: string): string {
  if (typeof globalThis.btoa === "function") {
    try {
      return globalThis.btoa(value);
    } catch (_) {
      /* expected: non-Latin1 string — fall back to TextEncoder */
      const bytes = new TextEncoder().encode(value);
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return globalThis.btoa(binary);
    }
  }

  const bufferCtor = (globalThis as { Buffer?: typeof Buffer }).Buffer;
  if (bufferCtor) return bufferCtor.from(value, "utf8").toString("base64");

  // This file ships in client bundles — keep it dependency-free (no error registry).
  throw new Error("Base64 encoding is not supported in this runtime");
}

/** Encode a string as unpadded base64url. */
export function base64urlEncode(input: string): string {
  return toBase64Url(encodeBase64(input));
}

/** Encode raw bytes as unpadded base64url. */
export function base64urlEncodeBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return toBase64Url(btoa(binary));
}
