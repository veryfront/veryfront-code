/**
 * The typed run event contract the Veryfront API publishes.
 *
 * Every run event surface returns rows that carry a span envelope and a
 * payload, keyed `payload` and named by a catalogued type. This module owns
 * the reader's half of that contract: the type vocabulary, the AG-UI wire
 * names, the envelope and row schemas, and one payload schema per type.
 * Import it instead of writing the names or shapes out again. The typed
 * contract is the only one: `format=typed` is accepted and ignored
 * (deprecated), and `format=raw` is refused, so do not send `format`.
 *
 * Every schema here is lazy and materializes through the registered
 * `SchemaValidator` contract, so a consumer outside a Veryfront app must
 * register one before the first `get*Schema()` call or
 * `parseTypedRunEventRow`. `register` replaces whatever is registered, so gate
 * it on `tryResolve` to leave an existing validator in place:
 *
 * ```ts
 * import { register, tryResolve } from "veryfront/extensions/contracts";
 * import { createZodAdapter } from "@veryfront/ext-schema-zod";
 *
 * if (!tryResolve("SchemaValidator")) {
 *   register("SchemaValidator", createZodAdapter());
 * }
 * ```
 *
 * Inside a Veryfront app, bootstrap registers the app's validator before
 * handlers run, and the gate keeps it; never call `register` unconditionally
 * there, since that would replace a lifecycle-owned validator. This module
 * ships no fallback validator: calling a getter with nothing registered throws
 * an error naming the contract and this registration call.
 *
 * @module run-events
 *
 * @example
 * ```ts
 * import { register, tryResolve } from "veryfront/extensions/contracts";
 * import { createZodAdapter } from "@veryfront/ext-schema-zod";
 * import {
 *   isRunEventType,
 *   parseTypedRunEventRow,
 *   RUN_EVENT_PAYLOAD_SCHEMAS,
 * } from "veryfront/run-events";
 *
 * // Register a validator only when nothing has: outside a Veryfront app this
 * // installs the Zod adapter, inside one it keeps the validator bootstrap owns.
 * if (!tryResolve("SchemaValidator")) {
 *   register("SchemaValidator", createZodAdapter());
 * }
 *
 * const apiUrl = "https://api.veryfront.example";
 * const runId = "<RUN_ID>";
 * const token = "<TOKEN>";
 *
 * const response = await fetch(`${apiUrl}/runs/${runId}/events`, {
 *   headers: { Authorization: `Bearer ${token}` },
 * });
 * const body = await response.json() as { data: unknown[] };
 *
 * for (const raw of body.data) {
 *   const row = parseTypedRunEventRow(raw);
 *   if (!isRunEventType(row.event_type)) {
 *     // A type this build predates: the envelope is still valid, so keep the
 *     // row and render its raw payload rather than dropping it.
 *     console.log(row.event_type, row.span_id, row.payload);
 *     continue;
 *   }
 *   // The sixteen control-plane `AGENT_RUN_*` types have no payload schema:
 *   // the API owns their shape and sanitizes it before a reader ever sees
 *   // it, so fall back to the already-validated raw payload for those.
 *   const schema = RUN_EVENT_PAYLOAD_SCHEMAS[row.event_type];
 *   const result = schema?.().safeParse(row.payload);
 *   console.log(row.event_type, row.span_id, result?.success ? result.data : row.payload);
 * }
 * ```
 */

export {
  assertRunEventSchemaValidator,
  RUN_EVENT_SCHEMA_VALIDATOR_CONTRACT,
  RUN_EVENT_SCHEMA_VALIDATOR_PACKAGE,
} from "./schema-validator.ts";

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
