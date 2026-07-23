/***********************
 * Base64 / base64url encoding utilities
 ***********************/

import type { Buffer } from "node:buffer";

function toBase64Url(b64: string): string {
  return b64.replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

/**
 * Encode a string as standard base64. Latin-1 input (all code points <= 0xFF)
 * is encoded with btoa's binary-string semantics; input outside Latin-1 falls
 * back to UTF-8 bytes. Callers that need guaranteed UTF-8 bytes regardless of
 * input (e.g. data: URLs decoded as UTF-8) should use
 * `encodeBase64Bytes(new TextEncoder().encode(value))` instead.
 */
export function encodeBase64(value: string): string {
  if (typeof globalThis.btoa === "function") {
    try {
      return globalThis.btoa(value);
    } catch (_) {
      /* expected: non-Latin1 string; fall back to UTF-8 bytes */
      return encodeBase64Bytes(new TextEncoder().encode(value));
    }
  }

  const bufferCtor = (globalThis as { Buffer?: typeof Buffer }).Buffer;
  if (bufferCtor) return bufferCtor.from(value, "utf8").toString("base64");

  // This file ships in client bundles — keep it dependency-free (no error registry).
  throw new Error("Base64 encoding is not supported in this runtime");
}

/** Encode raw bytes as standard base64. */
export function encodeBase64Bytes(bytes: Uint8Array): string {
  // Prefer Buffer where available (Node): avoids building a large intermediate
  // binary string, which is slower and can hit maximum-string-size limits.
  const bufferCtor = (globalThis as { Buffer?: typeof Buffer }).Buffer;
  if (bufferCtor) return bufferCtor.from(bytes).toString("base64");

  if (typeof globalThis.btoa === "function") {
    // The chunk size stays below engine argument limits and is divisible by
    // three, so only the final base64 chunk can contain padding.
    const chunkSize = 24 * 1024;
    let encoded = "";
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      encoded += globalThis.btoa(
        String.fromCharCode(...bytes.subarray(offset, offset + chunkSize)),
      );
    }
    return encoded;
  }

  throw new Error("Base64 encoding is not supported in this runtime");
}

/** Encode a UTF-8 string as unpadded base64url. */
export function base64urlEncode(input: string): string {
  return base64urlEncodeBytes(new TextEncoder().encode(input));
}

/** Encode raw bytes as unpadded base64url. */
export function base64urlEncodeBytes(bytes: Uint8Array): string {
  return toBase64Url(encodeBase64Bytes(bytes));
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
