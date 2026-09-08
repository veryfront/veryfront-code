import type { InferSchema, Schema } from "#veryfront/extensions/schema/index.ts";
import { defineSchema, getJsonValueSchema, type JsonValue } from "#veryfront/schemas/index.ts";
import { snapshotBoundedJsonValue } from "#veryfront/schemas/json-value.ts";
import { getEnumerableOwnStringDataEntries } from "#veryfront/tool/data-properties.ts";
import { isToolAnnotations } from "#veryfront/tool/mcp-metadata.ts";
import type { ToolDefinition, ToolExecutionDataEvent } from "#veryfront/tool/types.ts";
import { CURATED_PROVIDER_FAILURE_CODES } from "#veryfront/chat/provider-error-registry.ts";
import { snapshotVeryfrontError } from "#veryfront/errors/types.ts";
import { EXECUTOR_MAX_FRAME_BYTES } from "../executor/protocol.ts";
import { ExecutorAgentError, executorAgentFailureCode } from "./executor-agent-schema.ts";
import { executorModelFailure } from "./executor-model-errors.ts";

// Reserve the channel envelope, including escaped binding strings and the prefix.
export const EXECUTOR_TOOL_MAX_PAYLOAD_BYTES = EXECUTOR_MAX_FRAME_BYTES - 2048;
export const EXECUTOR_TOOL_LIMITS = Object.freeze({
  maxSources: 32,
  maxToolsPerSource: 1024,
  maxTotalTools: 4096,
  maxMetadataBytes: 8 * 1024 * 1024,
  maxDescriptorBytes: 256 * 1024,
  maxArgumentBytes: 256 * 1024,
  maxResultBytes: EXECUTOR_TOOL_MAX_PAYLOAD_BYTES - 128,
  maxProgressEvents: 1024,
  maxProgressBytes: 1024 * 1024,
  maxProgressEventBytes: 64 * 1024,
  maxQueuedProgress: 16,
  maxQueuedProgressBytes: 256 * 1024,
});
export type ExecutorToolLimits = { -readonly [K in keyof typeof EXECUTOR_TOOL_LIMITS]: number };

export function executorToolLimit(value: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new TypeError("Invalid executor tool limit");
  }
  return value;
}

/** Trusted configuration can only tighten the finite protocol limits. */
export function executorToolLimits(
  overrides: Partial<ExecutorToolLimits> = {},
): ExecutorToolLimits {
  const limits: ExecutorToolLimits = { ...EXECUTOR_TOOL_LIMITS };
  for (const key of Object.keys(limits) as (keyof ExecutorToolLimits)[]) {
    limits[key] = executorToolLimit(overrides[key] ?? limits[key], limits[key]);
  }
  return Object.freeze(limits);
}

export const getExecutorToolIdSchema = defineSchema((v) => v.string().min(1).max(256));
export const getExecutorToolEmptySchema = defineSchema((v) => v.object({}).strict());
export const getExecutorToolListSchema = defineSchema((v) =>
  v.object({ sourceId: getExecutorToolIdSchema() }).strict()
);
export const getExecutorToolCallSchema = defineSchema((v) =>
  v.object({
    sourceId: getExecutorToolIdSchema(),
    toolName: getExecutorToolIdSchema(),
    args: v.record(v.string(), getJsonValueSchema()),
    toolCallId: v.string().min(1).max(256).optional(),
    progressToken: v.union([v.string().min(1).max(256), v.number()]).optional(),
  }).strict()
);
export type ExecutorToolCall = InferSchema<ReturnType<typeof getExecutorToolCallSchema>>;

const failureCodes = [
  ...CURATED_PROVIDER_FAILURE_CODES,
  "EXTERNAL_SERVICE_ERROR",
  "PERMISSION_DENIED",
  "DURABLE_RUN_EVENT_PERSISTENCE_FAILED",
  "ABORTED",
] as const;
export const getExecutorToolFrameSchema = defineSchema((v) =>
  v.discriminatedUnion("type", [
    v.object({ type: v.literal("source"), sourceId: getExecutorToolIdSchema() }).strict(),
    v.object({ type: v.literal("tool"), definition: getJsonValueSchema() }).strict(),
    v.object({ type: v.literal("progress"), event: getJsonValueSchema() }).strict(),
    v.object({ type: v.literal("result"), result: getJsonValueSchema() }).strict(),
    v.object({ type: v.literal("complete") }).strict(),
    v.object({ type: v.literal("failure"), code: v.enum(failureCodes).optional() }).strict(),
  ])
);
export type ExecutorToolFrame = InferSchema<ReturnType<typeof getExecutorToolFrameSchema>>;

export function executorToolBytes(value: JsonValue): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

/** Snapshot before validation or serialization. Never invoke toJSON or coerce non-data values. */
export function executorToolJson(
  value: unknown,
  maxBytes = EXECUTOR_TOOL_MAX_PAYLOAD_BYTES,
): JsonValue {
  const snapshot = snapshotBoundedJsonValue(value);
  if (!snapshot.success || executorToolBytes(snapshot.value) > maxBytes) {
    throw new TypeError("Executor tool data exceeds its JSON limits");
  }
  return snapshot.value;
}

export function parseExecutorToolData<T>(schema: Schema<T>, value: unknown): T {
  const snapshot = executorToolJson(value);
  if (!schema.safeParse(snapshot).success) throw new TypeError("Invalid executor tool data");
  // Validation-only schemas: preserve every JSON key, including schema property names.
  return snapshot as T;
}

export function executorToolDefinition(value: unknown, limits: ExecutorToolLimits): ToolDefinition {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Invalid executor tool definition");
  }
  // ToolDefinition permits explicit undefined for optional metadata. Omit only
  // these top-level values; schema properties themselves remain strict JSON.
  const entries = getEnumerableOwnStringDataEntries(value, "Executor tool definition");
  const data = executorToolJson(
    Object.fromEntries(
      entries.filter(([key, entry]) =>
        entry !== undefined || (key !== "title" && key !== "annotations")
      ),
    ),
    limits.maxDescriptorBytes,
  );
  if (
    !data || typeof data !== "object" || Array.isArray(data) ||
    Object.keys(data).some((key) =>
      !["name", "description", "parameters", "title", "annotations"].includes(key)
    ) ||
    typeof data.name !== "string" || !getExecutorToolIdSchema().safeParse(data.name).success ||
    typeof data.description !== "string" ||
    !data.parameters || typeof data.parameters !== "object" || Array.isArray(data.parameters) ||
    (data.title !== undefined && typeof data.title !== "string") ||
    (data.annotations !== undefined && !isToolAnnotations(data.annotations))
  ) throw new TypeError("Invalid executor tool definition");
  return {
    name: data.name,
    description: data.description,
    parameters: data.parameters,
    ...(data.title === undefined ? {} : { title: data.title }),
    ...(data.annotations === undefined ? {} : { annotations: data.annotations }),
  };
}

export function executorToolProgress(
  value: unknown,
  limits: ExecutorToolLimits,
): ToolExecutionDataEvent {
  const event = executorToolJson(value, limits.maxProgressEventBytes);
  if (
    !event || typeof event !== "object" || Array.isArray(event) ||
    typeof event.type !== "string" || !event.type.length || event.type.length > 256
  ) {
    throw new TypeError("Invalid executor tool progress");
  }
  return event as ToolExecutionDataEvent;
}

export function executorToolFailure(error: unknown): ExecutorToolFrame {
  // The provider parser's generic EXTERNAL_SERVICE_ERROR fallback cannot give
  // an unknown error authority to classify a reply. Agent codes need an
  // explicit code or registered error; model codes use the curated helper.
  const explicit = error !== null && typeof error === "object"
    ? Object.getOwnPropertyDescriptor(error, "code")?.value
    : undefined;
  const classified = snapshotVeryfrontError(error) || failureCodes.some((code) => code === explicit)
    ? executorAgentFailureCode(error, "EXECUTOR_AGENT_STREAM_FAILED")
    : executorModelFailure(error)?.code;
  const code = failureCodes.find((code) => code === classified);
  return { type: "failure", ...(code ? { code } : {}) };
}

export function throwExecutorToolFailure(frame: ExecutorToolFrame): void {
  if (frame.type === "failure") {
    if (frame.code) throw new ExecutorAgentError(frame.code);
    throw new TypeError("Executor tool operation failed");
  }
}
