import { utf8ByteLength } from "./utf8-byte-length.ts";

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
