/**
 * The run event vocabulary the Veryfront API publishes under `format=typed`.
 *
 * The API owns this list: `RUN_EVENT_TYPES` here mirrors the type union
 * `RunEventPayloadSchema` declares in the API's `run-event/payload.ts`, in the
 * same order, and the wire names mirror what the API's `toRunEventWireName`
 * returns for each of them. Consumers that read run events (Veryfront Studio,
 * a custom dashboard, a replay tool) import this module instead of writing the
 * names out again.
 *
 * The eight types this runtime itself emits are cross-checked against
 * `NATIVE_RUN_EVENTS`, the producer-side vocabulary, so the names a run writes
 * and the names a reader expects cannot drift apart inside this package.
 *
 * @module run-events/vocabulary
 */

import { NATIVE_RUN_EVENTS } from "#veryfront/agent/ag-ui/native-run-events.ts";

/**
 * Every catalogued run event type, in the API's declaration order: the AG-UI
 * core types (`CUSTOM` excluded, it has no typed projection), the Veryfront
 * control plane types, and the twelve extension types that replaced the
 * registered `CUSTOM` names, followed by `UNKNOWN`.
 *
 * The source of truth is the API's `RUN_EVENT_TYPES`. `vocabulary.test.ts`
 * pins the length and a digest of the sorted names against the values read
 * from that list, so a type added on the API side fails here rather than
 * reaching a consumer as an unrecognized string.
 */
export const RUN_EVENT_TYPES = [
  // AG-UI core.
  "RUN_STARTED",
  "RUN_FINISHED",
  "RUN_ERROR",
  "TEXT_MESSAGE_START",
  "TEXT_MESSAGE_CONTENT",
  "TEXT_MESSAGE_END",
  "TOOL_CALL_START",
  "TOOL_CALL_ARGS",
  "TOOL_CALL_CHUNK",
  "TOOL_CALL_END",
  "TOOL_CALL_RESULT",
  "STATE_SNAPSHOT",
  "STATE_DELTA",
  "MESSAGES_SNAPSHOT",
  "STEP_STARTED",
  "STEP_FINISHED",
  "REASONING_START",
  "REASONING_MESSAGE_START",
  "REASONING_MESSAGE_CONTENT",
  "REASONING_MESSAGE_END",
  "REASONING_CONTENT",
  "REASONING_END",
  "ACTIVITY_SNAPSHOT",
  "ACTIVITY_DELTA",
  // Veryfront control plane.
  "AGENT_RUN_AUTHORIZATION_SEALED",
  "AGENT_RUN_REQUEST_ENQUEUED",
  "AGENT_RUN_DEFAULT_CHAT_START_ENQUEUED",
  "AGENT_RUN_TOOL_RESULT_SUBMITTED",
  "AGENT_RUN_TOOL_RESULT_DELIVERY_FAILED",
  "AGENT_RUN_RUNTIME_OWNER_BOUND",
  "AGENT_RUN_RUNTIME_INVOKE_RETRY",
  "AGENT_RUN_CONTEXT_COMPACTED",
  "AGENT_RUN_TOOL_EXPOSURE_CHECKPOINT",
  "AGENT_RUN_PROVIDER_REPLAY_CHECKPOINT",
  "AGENT_RUN_PROVIDER_REPLAY_TURN_STARTED",
  "AGENT_RUN_PROVIDER_REPLAY_TURN_COMPLETE",
  "AGENT_RUN_MODEL_CALL_CONTEXT",
  "AGENT_RUN_CONTROL_PLANE_DISPATCH_RECEIPT",
  "AGENT_RUN_INVOKE_AGENT_BILLING_MODE_CHECKPOINT",
  "AGENT_RUN_RETAINED_BILLING_USAGE",
  // Extension types: the typed replacements for the registered CUSTOM names.
  "TOOL_CALL_STATUS_CHANGED",
  "INPUT_REQUEST_CREATED",
  "INPUT_REQUEST_UPDATED",
  "CHILD_RUN_STATUS_CHANGED",
  "RUN_PARKED",
  "RUN_LOG_CAPTURED",
  "STREAM_HEARTBEAT_EMITTED",
  "URL_CITED",
  "DOCUMENT_CITED",
  "FILE_ATTACHED",
  "FILES_CHANGED",
  "RUNTIME_EVENT_RECORDED",
  // legacy: removed in Phase F -- UNKNOWN exists only while unprojectable legacy rows can be read.
  "UNKNOWN",
] as const;

/** One catalogued run event type. */
export type RunEventType = (typeof RUN_EVENT_TYPES)[number];

const RUN_EVENT_TYPE_SET: ReadonlySet<string> = new Set(RUN_EVENT_TYPES);

/** Reports whether a stored `event_type` is one this vocabulary knows. */
export function isRunEventType(eventType: string): eventType is RunEventType {
  return RUN_EVENT_TYPE_SET.has(eventType);
}

/**
 * How a reader must treat the event: a `fact` stands on its own, a `delta`
 * only means something applied in order on top of the frames before it.
 */
export const RUN_EVENT_CLASSES = ["fact", "delta"] as const;

/** Fact or delta, as the API's `event_class` envelope field reports it. */
export type RunEventClass = (typeof RUN_EVENT_CLASSES)[number];

/**
 * The types the API classes as `delta`; every other catalogued type is a
 * `fact`. The set is consulted only for catalogued types: a type this
 * vocabulary has not learned yet may be a delta the API added later, so its
 * class comes from the row's `event_class` envelope field, never from here.
 */
const RUN_EVENT_DELTA_TYPES: ReadonlySet<string> = new Set<string>([
  "TEXT_MESSAGE_CONTENT",
  "TOOL_CALL_ARGS",
  "TOOL_CALL_CHUNK",
  "REASONING_MESSAGE_CONTENT",
  "REASONING_CONTENT",
  "STATE_DELTA",
  "ACTIVITY_DELTA",
]);

function classOfCataloguedType(eventType: RunEventType): RunEventClass {
  return RUN_EVENT_DELTA_TYPES.has(eventType) ? "delta" : "fact";
}

/**
 * The event class the API reports for a catalogued type, or `null` for a type
 * this vocabulary does not know. A `null` is not a fact: the API's
 * post-cutover rule leaves `event_type` open, so a newer API can serve a delta
 * this build predates, and the row's `event_class` envelope field is the
 * authority for it. Read that field rather than defaulting.
 */
export function getRunEventClass(eventType: string): RunEventClass | null {
  return isRunEventType(eventType) ? classOfCataloguedType(eventType) : null;
}

/**
 * The one class each catalogued type is served with, derived from
 * `RUN_EVENT_TYPES` and `getRunEventClass` so the two can never disagree.
 *
 * Used to reject a typed row whose `event_class` envelope field disagrees
 * with the class its `event_type` carries: an uncatalogued type has no entry
 * here on purpose, since the API's post-cutover rule leaves `event_type` open
 * and a type this vocabulary has not learned yet may carry any class.
 */
export const RUN_EVENT_CLASS_BY_TYPE: Readonly<Record<RunEventType, RunEventClass>> = Object
  .fromEntries(
    RUN_EVENT_TYPES.map((eventType) => [eventType, classOfCataloguedType(eventType)]),
  ) as Record<RunEventType, RunEventClass>;

/**
 * The AG-UI wire name each type carries as the SSE `event:` line.
 *
 * Written out rather than derived by PascalCasing the stored type. The two
 * agree for every type catalogued today, but the API resolves an AG-UI name
 * through its own `AGUIWireEventType` map first, so a future AG-UI rename
 * would break the derivation silently. `vocabulary.test.ts` pins these against
 * `NATIVE_RUN_EVENTS` for the eight types this runtime emits.
 */
const RUN_EVENT_WIRE_NAMES = {
  RUN_STARTED: "RunStarted",
  RUN_FINISHED: "RunFinished",
  RUN_ERROR: "RunError",
  TEXT_MESSAGE_START: "TextMessageStart",
  TEXT_MESSAGE_CONTENT: "TextMessageContent",
  TEXT_MESSAGE_END: "TextMessageEnd",
  TOOL_CALL_START: "ToolCallStart",
  TOOL_CALL_ARGS: "ToolCallArgs",
  TOOL_CALL_CHUNK: "ToolCallChunk",
  TOOL_CALL_END: "ToolCallEnd",
  TOOL_CALL_RESULT: "ToolCallResult",
  STATE_SNAPSHOT: "StateSnapshot",
  STATE_DELTA: "StateDelta",
  MESSAGES_SNAPSHOT: "MessagesSnapshot",
  STEP_STARTED: "StepStarted",
  STEP_FINISHED: "StepFinished",
  REASONING_START: "ReasoningStart",
  REASONING_MESSAGE_START: "ReasoningMessageStart",
  REASONING_MESSAGE_CONTENT: "ReasoningMessageContent",
  REASONING_MESSAGE_END: "ReasoningMessageEnd",
  REASONING_CONTENT: "ReasoningContent",
  REASONING_END: "ReasoningEnd",
  ACTIVITY_SNAPSHOT: "ActivitySnapshot",
  ACTIVITY_DELTA: "ActivityDelta",
  AGENT_RUN_AUTHORIZATION_SEALED: "AgentRunAuthorizationSealed",
  AGENT_RUN_REQUEST_ENQUEUED: "AgentRunRequestEnqueued",
  AGENT_RUN_DEFAULT_CHAT_START_ENQUEUED: "AgentRunDefaultChatStartEnqueued",
  AGENT_RUN_TOOL_RESULT_SUBMITTED: "AgentRunToolResultSubmitted",
  AGENT_RUN_TOOL_RESULT_DELIVERY_FAILED: "AgentRunToolResultDeliveryFailed",
  AGENT_RUN_RUNTIME_OWNER_BOUND: "AgentRunRuntimeOwnerBound",
  AGENT_RUN_RUNTIME_INVOKE_RETRY: "AgentRunRuntimeInvokeRetry",
  AGENT_RUN_CONTEXT_COMPACTED: "AgentRunContextCompacted",
  AGENT_RUN_TOOL_EXPOSURE_CHECKPOINT: "AgentRunToolExposureCheckpoint",
  AGENT_RUN_PROVIDER_REPLAY_CHECKPOINT: "AgentRunProviderReplayCheckpoint",
  AGENT_RUN_PROVIDER_REPLAY_TURN_STARTED: "AgentRunProviderReplayTurnStarted",
  AGENT_RUN_PROVIDER_REPLAY_TURN_COMPLETE: "AgentRunProviderReplayTurnComplete",
  AGENT_RUN_MODEL_CALL_CONTEXT: "AgentRunModelCallContext",
  AGENT_RUN_CONTROL_PLANE_DISPATCH_RECEIPT: "AgentRunControlPlaneDispatchReceipt",
  AGENT_RUN_INVOKE_AGENT_BILLING_MODE_CHECKPOINT: "AgentRunInvokeAgentBillingModeCheckpoint",
  AGENT_RUN_RETAINED_BILLING_USAGE: "AgentRunRetainedBillingUsage",
  TOOL_CALL_STATUS_CHANGED: "ToolCallStatusChanged",
  INPUT_REQUEST_CREATED: "InputRequestCreated",
  INPUT_REQUEST_UPDATED: "InputRequestUpdated",
  CHILD_RUN_STATUS_CHANGED: "ChildRunStatusChanged",
  RUN_PARKED: "RunParked",
  RUN_LOG_CAPTURED: "RunLogCaptured",
  STREAM_HEARTBEAT_EMITTED: "StreamHeartbeatEmitted",
  URL_CITED: "UrlCited",
  DOCUMENT_CITED: "DocumentCited",
  FILE_ATTACHED: "FileAttached",
  FILES_CHANGED: "FilesChanged",
  RUNTIME_EVENT_RECORDED: "RuntimeEventRecorded",
  UNKNOWN: "Unknown",
} as const satisfies Record<RunEventType, string>;

/** The AG-UI wire name of a catalogued run event type. */
export type RunEventWireName = (typeof RUN_EVENT_WIRE_NAMES)[RunEventType];

/**
 * The wire name a catalogued type carries on an SSE frame.
 *
 * @param eventType - A catalogued stored type.
 * @returns The PascalCase AG-UI wire name.
 *
 * @example
 * ```ts
 * import { toRunEventWireName } from "veryfront/run-events";
 *
 * toRunEventWireName("URL_CITED"); // "UrlCited"
 * ```
 */
export function toRunEventWireName(eventType: RunEventType): RunEventWireName {
  return RUN_EVENT_WIRE_NAMES[eventType];
}

/**
 * The reverse map. Built once and checked for collisions at module load: two
 * types sharing a wire name would make this direction ambiguous, and the
 * ambiguity must surface here rather than as a silently mistyped frame.
 */
const RUN_EVENT_TYPES_BY_WIRE_NAME: ReadonlyMap<string, RunEventType> = (() => {
  const byWireName = new Map<string, RunEventType>();
  for (const eventType of RUN_EVENT_TYPES) {
    const wireName = RUN_EVENT_WIRE_NAMES[eventType];
    const existing = byWireName.get(wireName);
    if (existing) {
      throw new Error(
        `Run event wire name "${wireName}" is claimed by both ${existing} and ${eventType}`,
      );
    }
    byWireName.set(wireName, eventType);
  }
  return byWireName;
})();

/**
 * The stored type behind an SSE frame's wire name, or null when the frame
 * carries a name this vocabulary does not know.
 *
 * A null return is not an error: the API adds types ahead of its consumers, so
 * a reader must ignore a frame it cannot name rather than fail the stream.
 *
 * @param wireName - The value of the SSE `event:` line.
 * @returns The catalogued stored type, or null.
 *
 * @example
 * ```ts
 * import { fromRunEventWireName } from "veryfront/run-events";
 *
 * fromRunEventWireName("UrlCited"); // "URL_CITED"
 * fromRunEventWireName("SomethingNew"); // null
 * ```
 */
export function fromRunEventWireName(wireName: string): RunEventType | null {
  return RUN_EVENT_TYPES_BY_WIRE_NAME.get(wireName) ?? null;
}

/**
 * The stored types this runtime emits natively, for a consumer that needs to
 * tell "Veryfront Code produced this" from "another producer did". Derived
 * from `NATIVE_RUN_EVENTS` so the producer list stays the one declaration.
 */
export const NATIVE_RUN_EVENT_TYPES: readonly RunEventType[] = NATIVE_RUN_EVENTS
  .map((entry) => entry.storedType);
