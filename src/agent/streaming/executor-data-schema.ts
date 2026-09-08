import { defineSchema, getJsonValueSchema, type JsonValue } from "#veryfront/schemas/index.ts";
import {
  ExecutorAgentError,
  executorAgentFailureCode,
  executorAgentJson,
  getExecutorAgentFailureCodeSchema,
} from "../hosted/executor-agent-schema.ts";

const getUsageSchema = defineSchema((v) => {
  const count = v.number().nonnegative().optional();
  return v.object({
    inputTokens: count,
    outputTokens: count,
    totalTokens: count,
    promptTokens: count,
    completionTokens: count,
    reasoningTokens: count,
    cachedInputTokens: count,
    cacheReadInputTokens: count,
    cacheCreationInputTokens: count,
    billableInputTokens: count,
    billableOutputTokens: count,
    costUsd: count,
    providerInputCostUsd: count,
    providerOutputCostUsd: count,
    providerCostUsd: count,
    veryfrontInputChargeUsd: count,
    veryfrontOutputChargeUsd: count,
    veryfrontChargeUsd: count,
    veryfrontBilledUsd: count,
    costCredits: count,
    inputTokenDetails: v.object({
      noCacheTokens: count,
      cacheReadTokens: count,
      cacheWriteTokens: count,
    }).strict().optional(),
    outputTokenDetails: v.object({ textTokens: count, reasoningTokens: count }).strict().optional(),
    costSource: v.enum(["gateway", "missing", "partial"] as const).optional(),
    billingMode: v.enum(["direct", "deferred"] as const).optional(),
    usageCaptureStatus: v.enum(["complete", "partial", "missing"] as const).optional(),
  }).strict();
});

/** The runtime data-event vocabulary consumed by the hosted UI converter. */
export const getExecutorDataEventSchema = defineSchema((v) => {
  const json = getJsonValueSchema();
  const id = v.string().min(1);
  const flags = {
    providerExecuted: v.boolean().optional(),
    dynamic: v.boolean().optional(),
    preliminary: v.boolean().optional(),
  };
  return v.union([
    v.object({ type: v.literal("message-start"), messageId: id.optional() }).strict(),
    v.object({
      type: v.enum(["message-finish", "finish"] as const),
      finishReason: v.string().optional(),
      usage: getUsageSchema().optional(),
      totalUsage: getUsageSchema().optional(),
      object: json.optional(),
    }).strict(),
    v.object({ type: v.enum(["step-start", "step-end"] as const) }).strict(),
    v.object({
      type: v.enum(["text-start", "text-end", "reasoning-start"] as const),
      id: id.optional(),
    }).strict(),
    v.object({
      type: v.literal("reasoning-end"),
      id: id.optional(),
      signature: v.string().optional(),
      redactedData: v.string().optional(),
    }).strict(),
    v.object({
      type: v.enum(["text-delta", "reasoning-delta"] as const),
      id: id.optional(),
      delta: v.string(),
    }).strict(),
    v.object({ type: v.literal("tool-input-start"), toolCallId: id, toolName: id, ...flags })
      .strict(),
    v.object({
      type: v.literal("tool-input-delta"),
      toolCallId: id,
      inputTextDelta: v.string().optional(),
      delta: v.string().optional(),
    }).strict().refine(
      (event) => event.inputTextDelta !== undefined || event.delta !== undefined,
      "Tool input delta is required",
    ),
    v.object({
      type: v.literal("tool-input-available"),
      toolCallId: id,
      toolName: id,
      input: json,
      ...flags,
    }).strict(),
    // The runtime emitter omits undefined results during JSON serialization.
    v.object({
      type: v.literal("tool-output-available"),
      toolCallId: id,
      output: json.optional(),
      ...flags,
    })
      .strict(),
    v.object({
      type: v.literal("tool-input-error"),
      toolCallId: id,
      toolName: id.optional(),
      input: json.optional(),
      errorText: v.string(),
      ...flags,
    }).strict(),
    v.object({ type: v.literal("tool-output-denied"), toolCallId: id }).strict(),
    v.object({
      type: v.literal("tool-output-error"),
      toolCallId: id,
      errorText: v.string(),
      ...flags,
    }).strict(),
    v.object({ type: v.literal("error"), error: v.string(), code: v.string().optional() }).strict(),
    v.object({ type: v.literal("data"), data: v.record(v.string(), json) }).strict(),
    v.object({ type: v.string().regex(/^data-.+$/), data: json.optional() }).strict(),
    v.object({
      type: v.literal("source-url"),
      sourceId: id.optional(),
      url: v.string(),
      title: v.string().optional(),
    }).strict(),
    v.object({
      type: v.literal("source-document"),
      sourceId: id,
      title: v.string(),
      mediaType: v.string(),
      filename: v.string().optional(),
    }).strict(),
    v.object({
      type: v.literal("file"),
      url: v.string(),
      mediaType: v.string(),
      filename: v.string().optional(),
    }).strict(),
  ]);
});

export const getExecutorAgentStreamFrameSchema = defineSchema((v) =>
  v.discriminatedUnion("type", [
    v.object({ type: v.literal("ready") }).strict(),
    v.object({ type: v.literal("event"), event: getExecutorDataEventSchema() }).strict(),
    v.object({ type: v.literal("complete") }).strict(),
    v.object({
      type: v.literal("failure"),
      phase: v.enum(["setup", "stream"] as const),
      code: getExecutorAgentFailureCodeSchema(),
    }).strict(),
  ])
);

export function parseExecutorDataEvent(input: unknown): JsonValue & { type: string } {
  const result = getExecutorDataEventSchema().safeParse(input);
  if (!result.success) throw new ExecutorAgentError("EXECUTOR_AGENT_INVALID_STREAM");
  const data = result.data.type === "error"
    ? (() => {
      const code = executorAgentFailureCode(
        { code: "code" in result.data ? result.data.code : undefined },
        "EXECUTOR_AGENT_STREAM_FAILED",
      );
      return { type: "error", code, error: code };
    })()
    : result.data;
  const value = executorAgentJson(data, "EXECUTOR_AGENT_INVALID_STREAM");
  if (
    value === null || typeof value !== "object" || Array.isArray(value) ||
    typeof value.type !== "string"
  ) {
    throw new ExecutorAgentError("EXECUTOR_AGENT_INVALID_STREAM");
  }
  return { ...value, type: value.type };
}
