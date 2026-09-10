/**
 * Per-type payload schemas for the API's typed run event contract.
 *
 * One getter per catalogued type, each mirroring the matching variant of the
 * API's `RunEventPayloadSchema` field for field. Every variant is closed on
 * `type` and open on keys: the required fields are checked, and anything else
 * the producer sent passes through, so a payload that gains a field does not
 * fail a reader built against an older version of this package.
 *
 * These are the API contract, not a decoder. `veryfront/chat/ag-ui`'s wire
 * event schema deliberately accepts looser values for the same events (an
 * untyped `title`, an absent `sourceId`) so that a frame the legacy `Custom`
 * wrapper would have rendered still decodes; that leniency belongs to the
 * decoder and must not be copied here, because a payload these schemas accept
 * is a payload the API's append route accepts.
 *
 * The sixteen control plane types (`AGENT_RUN_*`) have no getter. Their shapes
 * are owned by the API's own types and sanitized before they ever reach a
 * reader, so the API declares them as bare `{ type }` variants and there is
 * nothing here to mirror.
 *
 * @module run-events/payload
 */

import { defineSchema } from "#veryfront/schemas/index.ts";
import type { Schema, SchemaValidator } from "#veryfront/extensions/schema/index.ts";
import type { RunEventType } from "./vocabulary.ts";

/**
 * Build one payload variant: the `type` discriminant plus the declared fields,
 * open on every other key. Mirrors the `variant()` helper the API's
 * `payload.ts` uses, so the two can be compared line for line.
 */
function variant<const T extends RunEventType, S extends Record<string, Schema<unknown>>>(
  v: SchemaValidator,
  type: T,
  shape: S,
) {
  return v.object({ type: v.literal(type), ...shape }).passthrough();
}

/** A non-empty string, the API's `requiredString`. */
function requiredString(v: SchemaValidator): Schema<string> {
  return v.string().min(1);
}

/** An absent-or-non-empty string, the API's `optionalString`. */
function optionalString(v: SchemaValidator): Schema<string | undefined> {
  return v.string().min(1).optional();
}

/** A non-empty string or an explicit null, the API's `nullableString`. */
function nullableString(v: SchemaValidator): Schema<string | null> {
  return v.string().min(1).nullable();
}

/** An open JSON object, the API's `record`. */
function unknownRecord(v: SchemaValidator): Schema<Record<string, unknown>> {
  return v.record(v.string(), v.unknown());
}

/** Payload of a run that started. */
export const getRunStartedPayloadSchema = defineSchema((v) =>
  variant(v, "RUN_STARTED", { runId: optionalString(v) })
);

/** Payload of a run that finished, carrying provider and usage metadata. */
export const getRunFinishedPayloadSchema = defineSchema((v) =>
  variant(v, "RUN_FINISHED", {
    runId: optionalString(v),
    metadata: unknownRecord(v).optional(),
  })
);

/** Payload of a run that failed. */
export const getRunErrorPayloadSchema = defineSchema((v) =>
  variant(v, "RUN_ERROR", {
    runId: optionalString(v),
    code: optionalString(v),
    message: v.string().optional(),
    metadata: unknownRecord(v).optional(),
  })
);

/**
 * Payload that opens an assistant message. `contentId` is required: the API's
 * public normalization rejects a row without one rather than degrading it.
 */
export const getTextMessageStartPayloadSchema = defineSchema((v) =>
  variant(v, "TEXT_MESSAGE_START", {
    messageId: requiredString(v),
    contentId: requiredString(v),
    role: v.string().optional(),
  })
);

/** Payload carrying one text delta. Apply deltas in event id order. */
export const getTextMessageContentPayloadSchema = defineSchema((v) =>
  variant(v, "TEXT_MESSAGE_CONTENT", {
    messageId: requiredString(v),
    contentId: optionalString(v),
    delta: v.string(),
  })
);

/** Payload that closes an assistant message. */
export const getTextMessageEndPayloadSchema = defineSchema((v) =>
  variant(v, "TEXT_MESSAGE_END", {
    messageId: requiredString(v),
    contentId: optionalString(v),
  })
);

/** Payload that opens a tool call. `parentMessageId` names the assistant turn. */
export const getToolCallStartPayloadSchema = defineSchema((v) =>
  variant(v, "TOOL_CALL_START", {
    toolCallId: requiredString(v),
    toolCallName: requiredString(v),
    parentMessageId: optionalString(v),
  })
);

/** Payload carrying one tool argument delta. */
export const getToolCallArgsPayloadSchema = defineSchema((v) =>
  variant(v, "TOOL_CALL_ARGS", { toolCallId: requiredString(v), delta: v.string() })
);

/** Payload carrying one streamed tool chunk. */
export const getToolCallChunkPayloadSchema = defineSchema((v) =>
  variant(v, "TOOL_CALL_CHUNK", { toolCallId: requiredString(v), delta: v.string() })
);

/** Payload that closes a tool call's argument stream. */
export const getToolCallEndPayloadSchema = defineSchema((v) =>
  variant(v, "TOOL_CALL_END", { toolCallId: requiredString(v) })
);

/**
 * Payload of a tool result. `isError` is `null` when no producer evidence
 * exists; the API never defaults it to false.
 */
export const getToolCallResultPayloadSchema = defineSchema((v) =>
  variant(v, "TOOL_CALL_RESULT", {
    toolCallId: requiredString(v),
    messageId: optionalString(v),
    content: v.unknown(),
    isError: v.boolean().nullable(),
    role: v.literal("tool").optional(),
  })
);

/** Payload carrying the whole client state. */
export const getStateSnapshotPayloadSchema = defineSchema((v) =>
  variant(v, "STATE_SNAPSHOT", { snapshot: unknownRecord(v) })
);

/**
 * Payload carrying a state change. The delta stays `unknown`: the public
 * profile accepts both a legacy object delta and a JSON Patch operation array.
 */
export const getStateDeltaPayloadSchema = defineSchema((v) =>
  variant(v, "STATE_DELTA", { delta: v.unknown() })
);

/** Payload carrying the authoritative message list for a stream's start. */
export const getMessagesSnapshotPayloadSchema = defineSchema((v) =>
  variant(v, "MESSAGES_SNAPSHOT", { messages: v.array(unknownRecord(v)) })
);

/** Payload that opens a step, or a runtime turn when `runtime` is set. */
export const getStepStartedPayloadSchema = defineSchema((v) =>
  variant(v, "STEP_STARTED", {
    stepId: optionalString(v),
    stepName: optionalString(v),
    runtime: optionalString(v),
  })
);

/** Payload that closes a step, or a runtime turn when `runtime` is set. */
export const getStepFinishedPayloadSchema = defineSchema((v) =>
  variant(v, "STEP_FINISHED", {
    stepId: optionalString(v),
    stepName: optionalString(v),
    runtime: optionalString(v),
    status: optionalString(v),
  })
);

/** Payload that opens a reasoning block. */
export const getReasoningStartPayloadSchema = defineSchema((v) =>
  variant(v, "REASONING_START", { messageId: optionalString(v) })
);

/** Payload that opens a reasoning message. */
export const getReasoningMessageStartPayloadSchema = defineSchema((v) =>
  variant(v, "REASONING_MESSAGE_START", { messageId: requiredString(v) })
);

/** Payload carrying one reasoning delta. */
export const getReasoningMessageContentPayloadSchema = defineSchema((v) =>
  variant(v, "REASONING_MESSAGE_CONTENT", {
    messageId: requiredString(v),
    delta: v.string(),
  })
);

/** Payload that closes a reasoning message. */
export const getReasoningMessageEndPayloadSchema = defineSchema((v) =>
  variant(v, "REASONING_MESSAGE_END", { messageId: requiredString(v) })
);

/** Payload carrying one reasoning content delta. */
export const getReasoningContentPayloadSchema = defineSchema((v) =>
  variant(v, "REASONING_CONTENT", {
    messageId: optionalString(v),
    delta: v.string(),
  })
);

/** Payload that closes a reasoning block. */
export const getReasoningEndPayloadSchema = defineSchema((v) =>
  variant(v, "REASONING_END", { messageId: optionalString(v) })
);

/** Payload carrying an activity snapshot. Reserved: no producer emits it yet. */
export const getActivitySnapshotPayloadSchema = defineSchema((v) =>
  variant(v, "ACTIVITY_SNAPSHOT", {})
);

/** Payload carrying an activity delta. Reserved: no producer emits it yet. */
export const getActivityDeltaPayloadSchema = defineSchema((v) => variant(v, "ACTIVITY_DELTA", {}));

/**
 * Payload of a tool call status transition (`pending_input`,
 * `streaming_input`, `in_progress`, `completed`, `failed`). `toolCallName` is
 * null when the runtime reported a status before naming the call.
 */
export const getToolCallStatusChangedPayloadSchema = defineSchema((v) =>
  variant(v, "TOOL_CALL_STATUS_CHANGED", {
    toolCallId: requiredString(v),
    status: requiredString(v),
    toolCallName: nullableString(v),
  })
);

/** Payload of a form or approval input request opened for the run. */
export const getInputRequestCreatedPayloadSchema = defineSchema((v) =>
  variant(v, "INPUT_REQUEST_CREATED", {
    inputRequest: v.object({ id: requiredString(v) }).passthrough(),
  })
);

/** Payload of an open input request that changed. */
export const getInputRequestUpdatedPayloadSchema = defineSchema((v) =>
  variant(v, "INPUT_REQUEST_UPDATED", {
    inputRequest: v.object({ id: requiredString(v) }).passthrough(),
  })
);

/** Payload of an `invoke_agent` child run's lifecycle transition. */
export const getChildRunStatusChangedPayloadSchema = defineSchema((v) =>
  variant(v, "CHILD_RUN_STATUS_CHANGED", {
    toolCallId: requiredString(v),
    childRunId: requiredString(v),
    status: requiredString(v),
    childConversationId: nullableString(v).optional(),
    childMessageId: nullableString(v).optional(),
    childAgentId: nullableString(v).optional(),
    description: optionalString(v),
  })
);

/** Payload of a run parked waiting for integration authentication. Live only. */
export const getRunParkedPayloadSchema = defineSchema((v) =>
  variant(v, "RUN_PARKED", {
    runId: requiredString(v),
    reason: requiredString(v),
    lastEventId: v.number().int().nonnegative(),
  })
);

/** Payload carrying captured runtime execution logs. */
export const getRunLogCapturedPayloadSchema = defineSchema((v) =>
  variant(v, "RUN_LOG_CAPTURED", { logs: v.string() })
);

/** Payload of a live stream heartbeat. Never persisted. */
export const getStreamHeartbeatEmittedPayloadSchema = defineSchema((v) =>
  variant(v, "STREAM_HEARTBEAT_EMITTED", {
    runId: requiredString(v),
    lastEventId: v.number().int().nonnegative(),
  })
);

/** Payload of a URL citation attached to assistant output. */
export const getUrlCitedPayloadSchema = defineSchema((v) =>
  variant(v, "URL_CITED", {
    url: requiredString(v),
    sourceId: requiredString(v),
    title: optionalString(v),
  })
);

/** Payload of a document citation attached to assistant output. */
export const getDocumentCitedPayloadSchema = defineSchema((v) =>
  variant(v, "DOCUMENT_CITED", {
    mediaType: requiredString(v),
    sourceId: requiredString(v),
    title: optionalString(v),
    filename: optionalString(v),
  })
);

/** Payload of a file reference the run emitted. */
export const getFileAttachedPayloadSchema = defineSchema((v) =>
  variant(v, "FILE_ATTACHED", {
    mediaType: requiredString(v),
    url: optionalString(v),
    filename: optionalString(v),
  })
);

/** Payload of a file change set a runtime proposed or applied. */
export const getFilesChangedPayloadSchema = defineSchema((v) =>
  variant(v, "FILES_CHANGED", {
    id: nullableString(v),
    status: nullableString(v),
    changes: v.unknown(),
  })
);

/**
 * Payload of a runtime-native event with no AG-UI equivalent, recorded for
 * diagnostics. `value` is unconstrained JSON: this is the catch-all the
 * runtime context snapshot and the codex thread and session events use.
 */
export const getRuntimeEventRecordedPayloadSchema = defineSchema((v) =>
  variant(v, "RUNTIME_EVENT_RECORDED", {
    runtime: requiredString(v),
    kind: requiredString(v),
    value: v.unknown(),
  })
);

/**
 * Payload of a row whose stored type or CUSTOM name has no typed projection.
 * `originalType` and `raw` carry what the row actually held.
 */
// legacy: removed in Phase F -- nothing projects to UNKNOWN once CUSTOM rows stop existing.
export const getUnknownRunEventPayloadSchema = defineSchema((v) =>
  variant(v, "UNKNOWN", {
    originalType: requiredString(v),
    name: nullableString(v),
    raw: v.unknown(),
  })
);

/**
 * Every per-type payload schema, keyed by stored type, for a reader that
 * validates a row whose type it only learns at runtime. Types without a
 * declared payload shape (the sixteen control plane types) are absent, which
 * is the signal to validate the envelope only.
 *
 * @example
 * ```ts
 * import { RUN_EVENT_PAYLOAD_SCHEMAS } from "veryfront/run-events";
 *
 * const getSchema = RUN_EVENT_PAYLOAD_SCHEMAS["URL_CITED"];
 * const payload = getSchema?.().parse({ type: "URL_CITED", url: "https://example.com", sourceId: "web-1" });
 * ```
 */
export const RUN_EVENT_PAYLOAD_SCHEMAS: Readonly<
  Partial<Record<RunEventType, () => Schema<Record<string, unknown>>>>
> = {
  RUN_STARTED: getRunStartedPayloadSchema,
  RUN_FINISHED: getRunFinishedPayloadSchema,
  RUN_ERROR: getRunErrorPayloadSchema,
  TEXT_MESSAGE_START: getTextMessageStartPayloadSchema,
  TEXT_MESSAGE_CONTENT: getTextMessageContentPayloadSchema,
  TEXT_MESSAGE_END: getTextMessageEndPayloadSchema,
  TOOL_CALL_START: getToolCallStartPayloadSchema,
  TOOL_CALL_ARGS: getToolCallArgsPayloadSchema,
  TOOL_CALL_CHUNK: getToolCallChunkPayloadSchema,
  TOOL_CALL_END: getToolCallEndPayloadSchema,
  TOOL_CALL_RESULT: getToolCallResultPayloadSchema,
  STATE_SNAPSHOT: getStateSnapshotPayloadSchema,
  STATE_DELTA: getStateDeltaPayloadSchema,
  MESSAGES_SNAPSHOT: getMessagesSnapshotPayloadSchema,
  STEP_STARTED: getStepStartedPayloadSchema,
  STEP_FINISHED: getStepFinishedPayloadSchema,
  REASONING_START: getReasoningStartPayloadSchema,
  REASONING_MESSAGE_START: getReasoningMessageStartPayloadSchema,
  REASONING_MESSAGE_CONTENT: getReasoningMessageContentPayloadSchema,
  REASONING_MESSAGE_END: getReasoningMessageEndPayloadSchema,
  REASONING_CONTENT: getReasoningContentPayloadSchema,
  REASONING_END: getReasoningEndPayloadSchema,
  ACTIVITY_SNAPSHOT: getActivitySnapshotPayloadSchema,
  ACTIVITY_DELTA: getActivityDeltaPayloadSchema,
  TOOL_CALL_STATUS_CHANGED: getToolCallStatusChangedPayloadSchema,
  INPUT_REQUEST_CREATED: getInputRequestCreatedPayloadSchema,
  INPUT_REQUEST_UPDATED: getInputRequestUpdatedPayloadSchema,
  CHILD_RUN_STATUS_CHANGED: getChildRunStatusChangedPayloadSchema,
  RUN_PARKED: getRunParkedPayloadSchema,
  RUN_LOG_CAPTURED: getRunLogCapturedPayloadSchema,
  STREAM_HEARTBEAT_EMITTED: getStreamHeartbeatEmittedPayloadSchema,
  URL_CITED: getUrlCitedPayloadSchema,
  DOCUMENT_CITED: getDocumentCitedPayloadSchema,
  FILE_ATTACHED: getFileAttachedPayloadSchema,
  FILES_CHANGED: getFilesChangedPayloadSchema,
  RUNTIME_EVENT_RECORDED: getRuntimeEventRecordedPayloadSchema,
  UNKNOWN: getUnknownRunEventPayloadSchema,
};
