/** Display metadata for run events. Names and groups do not change wire payloads. */
import type { RunEventType } from "./vocabulary.ts";

/** Run event groups in reference and navigation order. */
export const RUN_EVENT_GROUPS = Object.freeze(([
  { id: "run", name: "Run" },
  { id: "step", name: "Step" },
  { id: "model-call", name: "Model call" },
  { id: "reasoning", name: "Reasoning" },
  { id: "text", name: "Text" },
  { id: "tool-call", name: "Tool call" },
  { id: "input-request", name: "Input request" },
  { id: "artefacts", name: "Artefacts" },
  { id: "state-and-activity", name: "State and activity" },
  { id: "management", name: "Management" },
  { id: "billing", name: "Billing" },
  { id: "diagnostics", name: "Diagnostics" },
] as const).map((group) => Object.freeze(group)));

/** Stable identifier of a presentation group. */
export type RunEventGroup = (typeof RUN_EVENT_GROUPS)[number]["id"];

/** An event type and its display metadata, separate from an emitted event payload. */
export interface RunEventDefinition {
  readonly type: RunEventType;
  readonly name: string;
  readonly group: RunEventGroup;
}

const definitions = {
  AGENT_RUN_REQUEST_ENQUEUED: { name: "Run queued", group: "run" },
  AGENT_RUN_DEFAULT_CHAT_START_ENQUEUED: { name: "Default chat queued", group: "run" },
  RUN_STARTED: { name: "Run started", group: "run" },
  RUN_PARKED: { name: "Run waiting", group: "run" },
  CHILD_RUN_STATUS_CHANGED: { name: "Child run updated", group: "run" },
  RUN_FINISHED: { name: "Run finished", group: "run" },
  RUN_ERROR: { name: "Run error", group: "run" },
  STEP_STARTED: { name: "Step started", group: "step" },
  STEP_FINISHED: { name: "Step finished", group: "step" },
  AGENT_RUN_MODEL_CALL_CONTEXT_RECORDED: { name: "Model call recorded", group: "model-call" },
  MODEL_CALL_COMPLETED: { name: "Model usage recorded", group: "model-call" },
  REASONING_START: { name: "Reasoning started", group: "reasoning" },
  REASONING_MESSAGE_START: { name: "Reasoning message started", group: "reasoning" },
  REASONING_MESSAGE_CONTENT: { name: "Reasoning message updated", group: "reasoning" },
  REASONING_MESSAGE_END: { name: "Reasoning message finished", group: "reasoning" },
  REASONING_CONTENT: { name: "Reasoning updated", group: "reasoning" },
  REASONING_END: { name: "Reasoning finished", group: "reasoning" },
  TEXT_MESSAGE_START: { name: "Text started", group: "text" },
  TEXT_MESSAGE_CONTENT: { name: "Text updated", group: "text" },
  TEXT_MESSAGE_END: { name: "Text finished", group: "text" },
  TOOL_CALL_START: { name: "Tool call started", group: "tool-call" },
  TOOL_CALL_ARGS: { name: "Tool arguments updated", group: "tool-call" },
  TOOL_CALL_CHUNK: { name: "Tool call updated", group: "tool-call" },
  TOOL_CALL_END: { name: "Tool arguments finished", group: "tool-call" },
  TOOL_CALL_STATUS_CHANGED: { name: "Tool status updated", group: "tool-call" },
  AGENT_RUN_INTEGRATION_CONNECTION_REFUSED: { name: "Integration unavailable", group: "tool-call" },
  TOOL_CALL_RESULT: { name: "Tool result recorded", group: "tool-call" },
  AGENT_RUN_TOOL_RESULT_SUBMITTED: { name: "Tool result submitted", group: "tool-call" },
  AGENT_RUN_TOOL_RESULT_DELIVERY_FAILED: {
    name: "Tool result delivery failed",
    group: "tool-call",
  },
  INPUT_REQUEST_CREATED: { name: "Input requested", group: "input-request" },
  INPUT_REQUEST_UPDATED: { name: "Input request updated", group: "input-request" },
  URL_CITED: { name: "URL cited", group: "artefacts" },
  DOCUMENT_CITED: { name: "Document cited", group: "artefacts" },
  FILE_ATTACHED: { name: "File attached", group: "artefacts" },
  FILES_CHANGED: { name: "Files changed", group: "artefacts" },
  STATE_SNAPSHOT: { name: "State", group: "state-and-activity" },
  STATE_DELTA: { name: "State updated", group: "state-and-activity" },
  MESSAGES_SNAPSHOT: { name: "Messages", group: "state-and-activity" },
  ACTIVITY_SNAPSHOT: { name: "Activity", group: "state-and-activity" },
  ACTIVITY_DELTA: { name: "Activity updated", group: "state-and-activity" },
  AGENT_RUN_AUTHORIZATION_SEALED: { name: "Authorization recorded", group: "management" },
  AGENT_RUN_REPLAYED_UPLOADS_SEALED: { name: "Uploads recorded", group: "management" },
  AGENT_RUN_TOOL_EXPOSURE_CHECKPOINTED: { name: "Available tools recorded", group: "management" },
  AGENT_RUN_CONTROL_PLANE_DISPATCH_ACCEPTED: { name: "Run dispatch accepted", group: "management" },
  AGENT_RUN_RUNTIME_OWNER_BOUND: { name: "Runtime assigned", group: "management" },
  AGENT_RUN_DETACHED_ACCEPTED: { name: "Detached run accepted", group: "management" },
  AGENT_RUN_RUNTIME_INVOKE_RETRIED: { name: "Runtime call retried", group: "management" },
  AGENT_RUN_CONTEXT_COMPACTED: { name: "Context shortened", group: "management" },
  AGENT_RUN_PROVIDER_REPLAY_CHECKPOINTED: { name: "Replay state saved", group: "management" },
  AGENT_RUN_PROVIDER_REPLAY_TURN_STARTED: { name: "Replay turn started", group: "management" },
  AGENT_RUN_PROVIDER_REPLAY_TURN_FINISHED: { name: "Replay turn finished", group: "management" },
  AGENT_RUN_INVOKE_AGENT_BILLING_MODE_RETAINED: { name: "Billing mode kept", group: "billing" },
  AGENT_RUN_BILLING_USAGE_RETAINED: { name: "Usage kept", group: "billing" },
  RUN_LOG_CAPTURED: { name: "Run log recorded", group: "diagnostics" },
  RUNTIME_EVENT_RECORDED: { name: "Runtime event recorded", group: "diagnostics" },
  STREAM_HEARTBEAT_EMITTED: { name: "Stream heartbeat", group: "diagnostics" },
  UNKNOWN: { name: "Unknown event", group: "diagnostics" },
} as const satisfies Record<RunEventType, Omit<RunEventDefinition, "type">>;

/**
 * Run event definitions ordered by group, then by lifecycle within each group.
 * Includes the legacy `UNKNOWN` fallback; catalog membership does not imply
 * that a type is emitted or persisted by every runtime.
 */
export const RUN_EVENT_CATALOG: readonly RunEventDefinition[] = Object.freeze(
  (Object.keys(definitions) as RunEventType[]).map((type) =>
    Object.freeze({ type, ...definitions[type] })
  ),
);

const definitionsByType: ReadonlyMap<string, RunEventDefinition> = new Map(
  RUN_EVENT_CATALOG.map((event) => [event.type, event]),
);

/**
 * Look up a display name and group without registering a schema validator.
 * Returns null for an unrecognized type so callers can display its original name.
 *
 * @example
 * ```ts
 * import { getRunEventDefinition } from "veryfront/run-events";
 *
 * const event = getRunEventDefinition("RUN_STARTED");
 * console.log(event?.name); // "Run started"
 * ```
 */
export function getRunEventDefinition(type: string): RunEventDefinition | null {
  return definitionsByType.get(type) ?? null;
}
