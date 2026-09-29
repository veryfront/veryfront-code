/**
 * The typed run event contract the Veryfront API publishes.
 *
 * Every run event surface returns rows that carry a span envelope and a
 * payload, keyed `payload` and named by a catalogued type. This module owns
 * the reader's half of that contract: the type vocabulary, display names, groups, categories and kinds, the AG-UI wire
 * names, the envelope and row schemas, and one payload schema per type.
 * Import it instead of writing the names or shapes out again. The typed
 * contract is the only one: `format=typed` is accepted and ignored
 * (deprecated), and `format=raw` is refused, so do not send `format`.
 *
 * `RUN_EVENT_CATALOG` lists each event's `type`, display `name`, reference
 * `group`, filter `category` and semantic `kind`. `RUN_EVENT_GROUPS`,
 * `RUN_EVENT_CATEGORIES` and `RUN_EVENT_KINDS` supply the ordered IDs and names;
 * `RUN_EVENT_CATEGORY_HEADINGS` places the categories under the filter's
 * Interactions and System headings. These are display metadata, not fields
 * added to event payloads, and need no schema validator. The catalog includes
 * the legacy `UNKNOWN` fallback alongside current types. `getRunEventCategory`
 * and `getRunEventKind` accept any stored type: a legacy alias resolves to its
 * current type (`RUN_EVENT_TYPE_ALIASES`) and an unrecognized type falls back to
 * `system` and `runtime`.
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
 * import { RUN_EVENT_CATALOG, RUN_EVENT_GROUPS } from "veryfront/run-events";
 *
 * for (const group of RUN_EVENT_GROUPS) {
 *   const events = RUN_EVENT_CATALOG.filter((event) => event.group === group.id);
 *   console.log(group.name, events.map(({ type, name }) => ({ type, name })));
 * }
 * ```
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
 *   // Most control-plane `AGENT_RUN_*` types have no payload schema, and
 *   // viewer rows can be redacted: fall back to the already-validated raw
 *   // payload when there is no schema or the payload does not match.
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
  type ConversationTypedRunEventRowInput,
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
  getAgentRunDetachedAcceptedPayloadSchema,
  getAgentRunIntegrationConnectionRefusedPayloadSchema,
  getChildRunStatusChangedPayloadSchema,
  getDocumentCitedPayloadSchema,
  getFileAttachedPayloadSchema,
  getFilesChangedPayloadSchema,
  getInputRequestCreatedPayloadSchema,
  getInputRequestUpdatedPayloadSchema,
  getMessagesSnapshotPayloadSchema,
  getModelCallCompletedPayloadSchema,
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

export {
  getRunEventCategory,
  getRunEventDefinition,
  getRunEventKind,
  resolveRunEventType,
  RUN_EVENT_CATALOG,
  RUN_EVENT_CATEGORIES,
  RUN_EVENT_CATEGORY_HEADINGS,
  RUN_EVENT_GROUPS,
  RUN_EVENT_KINDS,
  RUN_EVENT_TYPE_ALIASES,
  type RunEventCategory,
  type RunEventDefinition,
  type RunEventGroup,
  type RunEventKind,
} from "./catalog.ts";
