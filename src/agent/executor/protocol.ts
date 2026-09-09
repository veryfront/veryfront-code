import { createPrivateTextDecoder, encodePrivateText } from "#veryfront/security/private-text.ts";
import { protectPrivateStreamReader } from "#veryfront/security/private-stream.ts";
import {
  isPrivateUint8Array,
  privateByteLength,
  privateByteSubarray,
  PrivateUint8Array,
  setPrivateBytes,
} from "#veryfront/security/private-bytes.ts";
import { privateJsonParse, privateJsonStringify } from "#veryfront/security/private-json.ts";
import type { InferSchema } from "#veryfront/extensions/schema/index.ts";
import { defineSchema, getJsonValueSchema } from "#veryfront/schemas/index.ts";
import { snapshotBoundedJsonValue } from "#veryfront/schemas/json-value.ts";

const min = Math.min;

/** Internal protocol limits. The frame limit includes its four-byte length prefix. */
export const EXECUTOR_PROTOCOL_VERSION = 1;
export const EXECUTOR_MAX_FRAME_BYTES = 1024 * 1024;
export const EXECUTOR_STREAM_WINDOW = 8;
export const EXECUTOR_MAX_CONCURRENT_CALLS = 32;
export const EXECUTOR_MAX_RETAINED_BYTES = 8 * 1024 * 1024;
export const EXECUTOR_MAX_TIMEOUT_MS = 24 * 60 * 60 * 1000;

export const getExecutorBindingSchema = defineSchema((v) =>
  v.object({
    allocationId: v.string().min(1).max(128),
    generation: v.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    invocationId: v.string().min(1).max(128),
  }).strict()
);

/** An authenticated transport must be bound to these exact values before use. */
export type ExecutorBinding = InferSchema<ReturnType<typeof getExecutorBindingSchema>>;

export const getExecutorFrameSchema = defineSchema((v) => {
  const id = v.number().int().positive().max(Number.MAX_SAFE_INTEGER);
  const sequence = v.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
  return v.object({
    version: v.literal(EXECUTOR_PROTOCOL_VERSION),
    binding: getExecutorBindingSchema(),
    sequence,
    message: v.discriminatedUnion("type", [
      v.object({ type: v.literal("hello") }).strict(),
      v.object({
        type: v.literal("request"),
        id,
        operation: v.string().min(1).max(128).regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/),
        mode: v.enum(["unary", "stream"] as const),
        timeoutMs: v.number().int().positive().max(EXECUTOR_MAX_TIMEOUT_MS),
        value: getJsonValueSchema(),
      }).strict(),
      v.object({ type: v.literal("data"), id, index: sequence, value: getJsonValueSchema() })
        .strict(),
      v.object({
        type: v.literal("end"),
        id,
        error: v.enum(
          [
            "operation-not-found",
            "mode-mismatch",
            "operation-failed",
            "cancelled",
            "deadline",
          ] as const,
        ).optional(),
      }).strict(),
      v.object({ type: v.literal("credit"), id, consumed: id }).strict(),
      v.object({ type: v.literal("cancel"), id }).strict(),
      v.object({ type: v.literal("release"), id }).strict(),
      v.object({ type: v.literal("released"), id }).strict(),
    ]),
  }).strict();
});

export type ExecutorFrame = InferSchema<ReturnType<typeof getExecutorFrameSchema>>;
export type ExecutorMessage = ExecutorFrame["message"];

/** Distinguishes local protocol diagnostics from opaque transport exceptions. */
export class ExecutorProtocolError extends Error {}

/** Validate and snapshot before encoding so non-JSON values cannot be silently coerced. */
export function encodeExecutorFrame(frame: ExecutorFrame): Uint8Array {
  const snapshot = snapshotBoundedJsonValue(frame);
  if (!snapshot.success || !getExecutorFrameSchema().safeParse(snapshot.value).success) {
    throw new TypeError("Invalid executor frame");
  }
  const payload = encodePrivateText(privateJsonStringify(snapshot.value));
  const length = privateByteLength(payload);
  if (length > EXECUTOR_MAX_FRAME_BYTES - 4) {
    throw new TypeError("Executor frame exceeds byte limit");
  }
  const bytes = new PrivateUint8Array(length + 4);
  bytes[0] = length >>> 24;
  bytes[1] = length >>> 16;
  bytes[2] = length >>> 8;
  bytes[3] = length;
  setPrivateBytes(bytes, payload, 4);
  return bytes;
}

/**
 * Read split or coalesced frames with one bounded frame allocation. Transport
 * adapters must emit chunks no larger than EXECUTOR_MAX_FRAME_BYTES.
 */
export async function* readExecutorFrames(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): AsyncGenerator<ExecutorFrame> {
  const privateReader = protectPrivateStreamReader(reader);
  const prefix = new PrivateUint8Array(4);
  let prefixOffset = 0;
  let payload: Uint8Array | undefined;
  let payloadOffset = 0;
  const decoder = createPrivateTextDecoder("utf-8", { fatal: true });
  while (true) {
    const { value: chunk, done } = await privateReader.read();
    if (done) {
      if (prefixOffset || payload) throw new ExecutorProtocolError("Truncated executor frame");
      return;
    }
    if (!isPrivateUint8Array(chunk) || privateByteLength(chunk) > EXECUTOR_MAX_FRAME_BYTES) {
      throw new ExecutorProtocolError("Executor transport chunk exceeds byte limit");
    }
    let offset = 0;
    while (offset < privateByteLength(chunk)) {
      if (!payload) {
        const size = min(4 - prefixOffset, privateByteLength(chunk) - offset);
        setPrivateBytes(prefix, privateByteSubarray(chunk, offset, offset + size), prefixOffset);
        offset += size;
        prefixOffset += size;
        if (prefixOffset < 4) continue;
        const length = prefix[0]! * 0x1000000 + prefix[1]! * 0x10000 + prefix[2]! * 0x100 +
          prefix[3]!;
        if (!length || length > EXECUTOR_MAX_FRAME_BYTES - 4) {
          throw new ExecutorProtocolError("Executor frame exceeds byte limit");
        }
        payload = new PrivateUint8Array(length);
        prefixOffset = 0;
      }
      const size = min(
        privateByteLength(payload) - payloadOffset,
        privateByteLength(chunk) - offset,
      );
      setPrivateBytes(payload, privateByteSubarray(chunk, offset, offset + size), payloadOffset);
      payloadOffset += size;
      offset += size;
      if (payloadOffset === privateByteLength(payload)) {
        let decoded: unknown;
        try {
          decoded = privateJsonParse(decoder.decode(payload));
        } catch {
          throw new ExecutorProtocolError("Invalid executor frame encoding");
        }
        if (
          decoded !== null && typeof decoded === "object" && "version" in decoded &&
          decoded.version !== EXECUTOR_PROTOCOL_VERSION
        ) throw new ExecutorProtocolError("Unsupported executor protocol version");
        const result = getExecutorFrameSchema().safeParse(decoded);
        if (!result.success) throw new ExecutorProtocolError("Invalid executor frame schema");
        payload = undefined;
        payloadOffset = 0;
        yield result.data;
      }
    }
  }
}
