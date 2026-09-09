import { utf8ByteLength } from "#veryfront/utils/utf8-byte-length.ts";
import { privateJsonParse, privateJsonStringify } from "#veryfront/security/private-json.ts";
import type { InferSchema, Schema } from "#veryfront/extensions/schema/index.ts";
import { defineSchema, getJsonValueSchema, type JsonValue } from "#veryfront/schemas/index.ts";
import { snapshotBoundedJsonValue } from "#veryfront/schemas/json-value.ts";
import { parseProviderError } from "#veryfront/chat/provider-errors.ts";
import { defineError, snapshotVeryfrontError, VeryfrontError } from "#veryfront/errors/types.ts";
import { EXECUTOR_MAX_FRAME_BYTES } from "../executor/protocol.ts";

const objectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;

// Reserve the complete worst-case protocol envelope: two 128-character binding
// strings can each require six JSON bytes per character, plus numeric identities,
// request metadata, and the four-byte frame prefix. This is a current wire limit,
// not a claim that every 1 MiB application request fits after runtime preparation.
export const EXECUTOR_AGENT_MAX_PAYLOAD_BYTES = EXECUTOR_MAX_FRAME_BYTES - 2048;

const failureStatus = {
  EXECUTOR_AGENT_INVALID_INPUT: 400,
  EXECUTOR_AGENT_INPUT_TOO_LARGE: 413,
  EXECUTOR_AGENT_ALREADY_STARTED: 409,
  EXECUTOR_AGENT_SETUP_FAILED: 500,
  EXECUTOR_AGENT_STREAM_FAILED: 502,
  EXECUTOR_AGENT_INVALID_STREAM: 502,
  OVERLOADED_ERROR: 503,
  CONTEXT_LENGTH_EXCEEDED: 413,
  INSUFFICIENT_CREDITS: 402,
  RESOURCE_LIMIT_EXCEEDED: 402,
  RATE_LIMITED: 429,
  PROJECT_SCHEMA_ERROR: 400,
  MODEL_UNSUPPORTED_ASSISTANT_PREFILL: 400,
  OUTPUT_SCHEMA_NOT_CLOSED: 400,
  AI_PROVIDER_SPEND_LIMIT_EXCEEDED: 402,
  AI_PROVIDER_WORKSPACE_LIMIT_EXCEEDED: 502,
  AI_PROVIDER_BILLING_ERROR: 502,
  EXTERNAL_SERVICE_ERROR: 502,
  PERMISSION_DENIED: 403,
  DURABLE_RUN_EVENT_PERSISTENCE_FAILED: 500,
  ABORTED: 499,
} as const;

/** @internal Fixed executor failure codes accepted by hosted response boundaries. */
export const EXECUTOR_AGENT_FAILURE_CODES = Object.freeze(
  [
    "EXECUTOR_AGENT_INVALID_INPUT",
    "EXECUTOR_AGENT_INPUT_TOO_LARGE",
    "EXECUTOR_AGENT_ALREADY_STARTED",
    "EXECUTOR_AGENT_SETUP_FAILED",
    "EXECUTOR_AGENT_STREAM_FAILED",
    "EXECUTOR_AGENT_INVALID_STREAM",
    "OVERLOADED_ERROR",
    "CONTEXT_LENGTH_EXCEEDED",
    "INSUFFICIENT_CREDITS",
    "RESOURCE_LIMIT_EXCEEDED",
    "RATE_LIMITED",
    "PROJECT_SCHEMA_ERROR",
    "MODEL_UNSUPPORTED_ASSISTANT_PREFILL",
    "OUTPUT_SCHEMA_NOT_CLOSED",
    "AI_PROVIDER_SPEND_LIMIT_EXCEEDED",
    "AI_PROVIDER_WORKSPACE_LIMIT_EXCEEDED",
    "AI_PROVIDER_BILLING_ERROR",
    "EXTERNAL_SERVICE_ERROR",
    "PERMISSION_DENIED",
    "DURABLE_RUN_EVENT_PERSISTENCE_FAILED",
    "ABORTED",
  ] as const,
);

export const getExecutorAgentFailureCodeSchema = defineSchema((v) =>
  v.enum(EXECUTOR_AGENT_FAILURE_CODES)
);
type FailureCode = InferSchema<ReturnType<typeof getExecutorAgentFailureCodeSchema>>;

/** @internal Fixed diagnostics contain neither rejected inputs nor upstream error bodies. */
export class ExecutorAgentError extends VeryfrontError {
  constructor(readonly code: FailureCode) {
    const definition = defineError({
      slug: code.toLowerCase().replaceAll("_", "-"),
      category: "AGENT",
      status: failureStatus[code],
      title: code,
    });
    super(code, definition);
    this.name = "ExecutorAgentError";
  }
}

export function executorAgentFailureCode(error: unknown, fallback: FailureCode): FailureCode {
  if (error instanceof ExecutorAgentError) return error.code;
  if (error !== null && typeof error === "object") {
    const descriptor = objectGetOwnPropertyDescriptor(error, "code");
    const explicit = getExecutorAgentFailureCodeSchema().safeParse(descriptor?.value);
    if (explicit.success) return explicit.data;
  }
  const snapshot = snapshotVeryfrontError(error);
  const code = snapshot?.slug.toUpperCase().replaceAll("-", "_") ?? parseProviderError(error).code;
  const result = getExecutorAgentFailureCodeSchema().safeParse(code);
  return result.success ? result.data : fallback;
}

export const getExecutorPreparedRuntimeHandleSchema = defineSchema((v) =>
  v.string().min(1).max(128).regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/)
);

export const getExecutorAgentStreamInputSchema = defineSchema((v) => {
  const json = getJsonValueSchema();
  const attachment = {
    url: v.string(),
    mediaType: v.string(),
    filename: v.string().optional(),
    uploadId: v.string().optional(),
    uploadPath: v.string().optional(),
  };
  const parts = v.union([
    v.object({ type: v.literal("text"), text: v.string() }).strict(),
    v.object({
      type: v.literal("reasoning"),
      text: v.string().optional(),
      signature: v.string().optional(),
      redactedData: v.string().optional(),
    }).strict(),
    v.object({
      type: v.string(),
      toolCallId: v.string(),
      toolName: v.string(),
      args: v.record(v.string(), json),
    }).strict(),
    v.object({
      type: v.literal("tool-result"),
      toolCallId: v.string(),
      toolName: v.string(),
      result: json,
    }).strict(),
    v.object({ type: v.literal("image"), ...attachment }).strict(),
    v.object({ type: v.literal("file"), ...attachment }).strict(),
    v.object({
      type: v.literal("source-url"),
      sourceId: v.string(),
      url: v.string(),
      title: v.string().optional(),
    }).strict(),
    v.object({
      type: v.literal("source-document"),
      sourceId: v.string(),
      title: v.string(),
      mediaType: v.string().optional(),
      filename: v.string().optional(),
    }).strict(),
  ]);
  return v.object({
    preparedRuntimeHandle: getExecutorPreparedRuntimeHandleSchema(),
    messages: v.array(
      v.object({
        id: v.string(),
        role: v.enum(["system", "user", "assistant", "tool"] as const),
        parts: v.array(parts).max(10_000),
        timestamp: v.number(),
      }).strict(),
    ).max(10_000),
  }).strict();
});

export function parseExecutorAgentData<T>(schema: Schema<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new ExecutorAgentError("EXECUTOR_AGENT_INVALID_INPUT");
  return result.data;
}

/** Serialize schema-validated values; optional undefined properties are omitted. */
export function executorAgentJson(input: unknown, oversized: FailureCode): JsonValue {
  const encoded = privateJsonStringify(input);
  if (
    encoded === undefined ||
    utf8ByteLength(encoded, EXECUTOR_AGENT_MAX_PAYLOAD_BYTES) > EXECUTOR_AGENT_MAX_PAYLOAD_BYTES
  ) {
    throw new ExecutorAgentError(oversized);
  }
  const snapshot = snapshotBoundedJsonValue(privateJsonParse(encoded));
  if (!snapshot.success) throw new ExecutorAgentError("EXECUTOR_AGENT_INVALID_INPUT");
  return snapshot.value;
}
