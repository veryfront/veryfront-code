import { utf8ByteLength } from "#veryfront/utils/utf8-byte-length.ts";

const numberIsSafeInteger = Number.isSafeInteger;
const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;
const NativeRangeError = RangeError;

export interface WebSocketMessageAdmission {
  readonly accepted: boolean;
  /**
   * Exact size when accepted, or a finite lower-bound sentinel when a string
   * is rejected early.
   */
  readonly sizeBytes: number;
}

/**
 * Return the wire-size boundary used for browser WebSocket message payloads.
 *
 * Strings are measured as UTF-8 rather than UTF-16 code units. ArrayBuffer
 * views use only their visible slice, and Blob payloads use their byte size
 * without materializing their contents.
 */
export function getWebSocketMessageSizeBytes(data: unknown): number {
  if (typeof data === "string") return utf8ByteLength(data);
  if (data instanceof ArrayBuffer) return data.byteLength;
  if (ArrayBuffer.isView(data)) return data.byteLength;
  if (typeof Blob !== "undefined" && data instanceof Blob) return data.size;
  return 0;
}

/**
 * Check a WebSocket payload against a byte limit without scanning beyond the
 * admission boundary. Exact-at-limit payloads remain accepted.
 */
export function getWebSocketMessageAdmission(
  data: unknown,
  maximumBytes: number,
): WebSocketMessageAdmission {
  if (!numberIsSafeInteger(maximumBytes) || maximumBytes < 0) {
    throw new NativeRangeError(
      "WebSocket message maximumBytes must be a non-negative safe integer",
    );
  }

  if (typeof data === "string") {
    const rejectedSize = maximumBytes === MAX_SAFE_INTEGER ? MAX_SAFE_INTEGER : maximumBytes + 1;
    if (data.length > maximumBytes) {
      return { accepted: false, sizeBytes: rejectedSize };
    }
    const sizeBytes = utf8ByteLength(data, maximumBytes);
    return { accepted: sizeBytes <= maximumBytes, sizeBytes };
  }

  const sizeBytes = getWebSocketMessageSizeBytes(data);
  return { accepted: sizeBytes <= maximumBytes, sizeBytes };
}
