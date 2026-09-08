import { privateJsonParse, privateJsonStringify } from "#veryfront/security/private-json.ts";
import type { InferSchema } from "#veryfront/extensions/schema/index.ts";
import { defineSchema, getJsonValueSchema } from "#veryfront/schemas/index.ts";
import { snapshotBoundedJsonValue } from "#veryfront/schemas/json-value.ts";

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
  const payload = new TextEncoder().encode(privateJsonStringify(snapshot.value));
  if (payload.byteLength > EXECUTOR_MAX_FRAME_BYTES - 4) {
    throw new TypeError("Executor frame exceeds byte limit");
  }
  const bytes = new Uint8Array(payload.byteLength + 4);
  new DataView(bytes.buffer).setUint32(0, payload.byteLength);
  bytes.set(payload, 4);
  return bytes;
}

/**
 * Read split or coalesced frames with one bounded frame allocation. Transport
 * adapters must emit chunks no larger than EXECUTOR_MAX_FRAME_BYTES.
 */
export async function* readExecutorFrames(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): AsyncGenerator<ExecutorFrame> {
  const prefix = new Uint8Array(4);
  let prefixOffset = 0;
  let payload: Uint8Array | undefined;
  let payloadOffset = 0;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  while (true) {
    const { value: chunk, done } = await reader.read();
    if (done) {
      if (prefixOffset || payload) throw new ExecutorProtocolError("Truncated executor frame");
      return;
    }
    if (!(chunk instanceof Uint8Array) || chunk.byteLength > EXECUTOR_MAX_FRAME_BYTES) {
      throw new ExecutorProtocolError("Executor transport chunk exceeds byte limit");
    }
    let offset = 0;
    while (offset < chunk.byteLength) {
      if (!payload) {
        const size = Math.min(4 - prefixOffset, chunk.byteLength - offset);
        prefix.set(chunk.subarray(offset, offset + size), prefixOffset);
        offset += size;
        prefixOffset += size;
        if (prefixOffset < 4) continue;
        const length = new DataView(prefix.buffer).getUint32(0);
        if (!length || length > EXECUTOR_MAX_FRAME_BYTES - 4) {
          throw new ExecutorProtocolError("Executor frame exceeds byte limit");
        }
        payload = new Uint8Array(length);
        prefixOffset = 0;
      }
      const size = Math.min(payload.byteLength - payloadOffset, chunk.byteLength - offset);
      payload.set(chunk.subarray(offset, offset + size), payloadOffset);
      payloadOffset += size;
      offset += size;
      if (payloadOffset === payload.byteLength) {
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
