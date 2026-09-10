/**
 * The typed run event contract the Veryfront API publishes.
 *
 * A run event surface read with `format=typed` returns rows that carry a span
 * envelope and a payload named by a catalogued type. This module owns the
 * reader's half of that contract: the type vocabulary, the AG-UI wire names,
 * the envelope and row schemas, and one payload schema per type. Import it
 * instead of writing the names or shapes out again.
 *
 * Schemas materialize through the registered `SchemaValidator`, so a
 * standalone consumer must register one (`@veryfront/ext-schema-zod`) before
 * the first `get*Schema()` call. Inside a Veryfront app, bootstrap does it.
 *
 * @module run-events
 *
 * @example
 * ```ts
 * import {
 *   isRunEventType,
 *   parseTypedRunEventRow,
 *   RUN_EVENT_PAYLOAD_SCHEMAS,
 * } from "veryfront/run-events";
 *
 * const response = await fetch(`${apiUrl}/runs/${runId}/events?format=typed`, {
 *   headers: { Authorization: `Bearer ${token}` },
 * });
 * const body = await response.json() as { data: unknown[] };
 *
 * for (const raw of body.data) {
 *   const row = parseTypedRunEventRow(raw);
 *   if (!isRunEventType(row.event_type)) continue;
 *   const result = RUN_EVENT_PAYLOAD_SCHEMAS[row.event_type]?.().safeParse(row.payload);
 *   if (result?.success) {
 *     console.log(row.event_type, row.span_id, result.data);
 *   }
 * }
 * ```
 */

export {
  type ConversationTypedRunEventRow,
  getConversationTypedRunEventRowSchema,
  getRunEventEnvelopeSchema,
  getTypedRunEventRowSchema,
  parseTypedRunEventRow,
  type RunEventEnvelope,
  type TypedRunEventRow,
} from "./envelope.ts";

export {
  getActivityDeltaPayloadSchema,
  getActivitySnapshotPayloadSchema,
  getChildRunStatusChangedPayloadSchema,
  getDocumentCitedPayloadSchema,
  getFileAttachedPayloadSchema,
  getFilesChangedPayloadSchema,
  getInputRequestCreatedPayloadSchema,
  getInputRequestUpdatedPayloadSchema,
  getMessagesSnapshotPayloadSchema,
  getReasoningContentPayloadSchema,
  getReasoningEndPayloadSchema,
  getReasoningMessageContentPayloadSchema,
  getReasoningMessageEndPayloadSchema,
  getReasoningMessageStartPayloadSchema,
  getReasoningStartPayloadSchema,
  getRunErrorPayloadSchema,
  getRunFinishedPayloadSchema,
  getRunLogCapturedPayloadSchema,
  getRunParkedPayloadSchema,
  getRunStartedPayloadSchema,
  getRuntimeEventRecordedPayloadSchema,
  getStateDeltaPayloadSchema,
  getStateSnapshotPayloadSchema,
  getStepFinishedPayloadSchema,
  getStepStartedPayloadSchema,
  getStreamHeartbeatEmittedPayloadSchema,
  getTextMessageContentPayloadSchema,
  getTextMessageEndPayloadSchema,
  getTextMessageStartPayloadSchema,
  getToolCallArgsPayloadSchema,
  getToolCallChunkPayloadSchema,
  getToolCallEndPayloadSchema,
  getToolCallResultPayloadSchema,
  getToolCallStartPayloadSchema,
  getToolCallStatusChangedPayloadSchema,
  getUnknownRunEventPayloadSchema,
  getUrlCitedPayloadSchema,
  RUN_EVENT_PAYLOAD_SCHEMAS,
} from "./payload.ts";

export {
  fromRunEventWireName,
  getRunEventClass,
  isRunEventType,
  NATIVE_RUN_EVENT_TYPES,
  RUN_EVENT_CLASSES,
  RUN_EVENT_TYPES,
  type RunEventClass,
  type RunEventType,
  type RunEventWireName,
  toRunEventWireName,
} from "./vocabulary.ts";
