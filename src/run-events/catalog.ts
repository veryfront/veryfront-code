/**
 * Display metadata for run events. Names, groups, categories and kinds do not
 * change wire payloads.
 */
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

/**
 * Run event filter categories in display order: which layer produced the event.
 * `ag-ui` is the AG-UI core protocol, `extensions` is Veryfront's typed extension
 * events, and `system` is the Veryfront control plane plus the legacy `UNKNOWN`
 * fallback. Categories are distinct from the reference groups above.
 */
export const RUN_EVENT_CATEGORIES = Object.freeze(([
  { id: "ag-ui", name: "AG-UI" },
  { id: "extensions", name: "Extensions" },
  { id: "system", name: "System" },
] as const).map((category) => Object.freeze(category)));

/** Stable identifier of a filter category. */
export type RunEventCategory = (typeof RUN_EVENT_CATEGORIES)[number]["id"];

/** Headings a run event filter shows its categories under, in display order. */
export const RUN_EVENT_CATEGORY_HEADINGS: readonly {
  readonly name: string;
  readonly categories: readonly RunEventCategory[];
}[] = Object.freeze([
  Object.freeze({
    name: "Interactions",
    categories: Object.freeze(["ag-ui", "extensions"] as const),
  }),
  Object.freeze({ name: "System", categories: Object.freeze(["system"] as const) }),
]);

/**
 * Semantic kinds in display order: what an event is about, independent of its
 * category and group. `llm` is displayed as "Model".
 */
export const RUN_EVENT_KINDS = Object.freeze(([
  { id: "llm", name: "Model" },
  { id: "tool", name: "Tool" },
  { id: "child", name: "Child run" },
  { id: "lifecycle", name: "Lifecycle" },
  { id: "input", name: "Input" },
  { id: "output", name: "Output" },
  { id: "state", name: "State" },
  { id: "runtime", name: "Runtime" },
] as const).map((kind) => Object.freeze(kind)));

/** Stable identifier of a semantic kind. */
export type RunEventKind = (typeof RUN_EVENT_KINDS)[number]["id"];

/** An event type and its display metadata, separate from an emitted event payload. */
export interface RunEventDefinition {
  readonly type: RunEventType;
  readonly name: string;
  readonly group: RunEventGroup;
  readonly category: RunEventCategory;
  readonly kind: RunEventKind;
}

const definitions = {
  AGENT_RUN_REQUEST_ENQUEUED: {
    name: "Run queued",
    group: "run",
    category: "system",
    kind: "runtime",
  },
  AGENT_RUN_DEFAULT_CHAT_START_ENQUEUED: {
    name: "Default chat queued",
    group: "run",
    category: "system",
    kind: "runtime",
  },
  RUN_STARTED: { name: "Run started", group: "run", category: "ag-ui", kind: "lifecycle" },
  RUN_PARKED: { name: "Run waiting", group: "run", category: "extensions", kind: "lifecycle" },
  CHILD_RUN_STATUS_CHANGED: {
    name: "Child run updated",
    group: "run",
    category: "extensions",
    kind: "child",
  },
  RUN_FINISHED: { name: "Run finished", group: "run", category: "ag-ui", kind: "lifecycle" },
  RUN_ERROR: { name: "Run error", group: "run", category: "ag-ui", kind: "lifecycle" },
  STEP_STARTED: { name: "Step started", group: "step", category: "ag-ui", kind: "lifecycle" },
  STEP_FINISHED: { name: "Step finished", group: "step", category: "ag-ui", kind: "lifecycle" },
  AGENT_RUN_MODEL_CALL_CONTEXT_RECORDED: {
    name: "Model call recorded",
    group: "model-call",
    category: "system",
    kind: "runtime",
  },
  MODEL_CALL_COMPLETED: {
    name: "Model usage recorded",
    group: "model-call",
    category: "extensions",
    kind: "llm",
  },
  REASONING_START: {
    name: "Reasoning started",
    group: "reasoning",
    category: "ag-ui",
    kind: "llm",
  },
  REASONING_MESSAGE_START: {
    name: "Reasoning message started",
    group: "reasoning",
    category: "ag-ui",
    kind: "llm",
  },
  REASONING_MESSAGE_CONTENT: {
    name: "Reasoning message updated",
    group: "reasoning",
    category: "ag-ui",
    kind: "llm",
  },
  REASONING_MESSAGE_END: {
    name: "Reasoning message finished",
    group: "reasoning",
    category: "ag-ui",
    kind: "llm",
  },
  REASONING_CONTENT: {
    name: "Reasoning updated",
    group: "reasoning",
    category: "ag-ui",
    kind: "llm",
  },
  REASONING_END: { name: "Reasoning finished", group: "reasoning", category: "ag-ui", kind: "llm" },
  TEXT_MESSAGE_START: { name: "Text started", group: "text", category: "ag-ui", kind: "llm" },
  TEXT_MESSAGE_CONTENT: { name: "Text updated", group: "text", category: "ag-ui", kind: "llm" },
  TEXT_MESSAGE_END: { name: "Text finished", group: "text", category: "ag-ui", kind: "llm" },
  TOOL_CALL_START: {
    name: "Tool call started",
    group: "tool-call",
    category: "ag-ui",
    kind: "tool",
  },
  TOOL_CALL_ARGS: {
    name: "Tool arguments updated",
    group: "tool-call",
    category: "ag-ui",
    kind: "tool",
  },
  TOOL_CALL_CHUNK: {
    name: "Tool call updated",
    group: "tool-call",
    category: "ag-ui",
    kind: "tool",
  },
  TOOL_CALL_END: {
    name: "Tool arguments finished",
    group: "tool-call",
    category: "ag-ui",
    kind: "tool",
  },
  TOOL_CALL_STATUS_CHANGED: {
    name: "Tool status updated",
    group: "tool-call",
    category: "extensions",
    kind: "tool",
  },
  AGENT_RUN_INTEGRATION_CONNECTION_REFUSED: {
    name: "Integration unavailable",
    group: "tool-call",
    category: "system",
    kind: "runtime",
  },
  TOOL_CALL_RESULT: {
    name: "Tool result recorded",
    group: "tool-call",
    category: "ag-ui",
    kind: "tool",
  },
  AGENT_RUN_TOOL_RESULT_SUBMITTED: {
    name: "Tool result submitted",
    group: "tool-call",
    category: "system",
    kind: "child",
  },
  AGENT_RUN_TOOL_RESULT_DELIVERY_FAILED: {
    name: "Tool result delivery failed",
    group: "tool-call",
    category: "system",
    kind: "child",
  },
  INPUT_REQUEST_CREATED: {
    name: "Input requested",
    group: "input-request",
    category: "extensions",
    kind: "input",
  },
  INPUT_REQUEST_UPDATED: {
    name: "Input request updated",
    group: "input-request",
    category: "extensions",
    kind: "input",
  },
  URL_CITED: { name: "URL cited", group: "artefacts", category: "extensions", kind: "output" },
  DOCUMENT_CITED: {
    name: "Document cited",
    group: "artefacts",
    category: "extensions",
    kind: "output",
  },
  FILE_ATTACHED: {
    name: "File attached",
    group: "artefacts",
    category: "extensions",
    kind: "output",
  },
  FILES_CHANGED: {
    name: "Files changed",
    group: "artefacts",
    category: "extensions",
    kind: "output",
  },
  STATE_SNAPSHOT: { name: "State", group: "state-and-activity", category: "ag-ui", kind: "state" },
  STATE_DELTA: {
    name: "State updated",
    group: "state-and-activity",
    category: "ag-ui",
    kind: "state",
  },
  MESSAGES_SNAPSHOT: {
    name: "Messages",
    group: "state-and-activity",
    category: "ag-ui",
    kind: "state",
  },
  ACTIVITY_SNAPSHOT: {
    name: "Activity",
    group: "state-and-activity",
    category: "ag-ui",
    kind: "state",
  },
  ACTIVITY_DELTA: {
    name: "Activity updated",
    group: "state-and-activity",
    category: "ag-ui",
    kind: "state",
  },
  AGENT_RUN_AUTHORIZATION_SEALED: {
    name: "Authorization recorded",
    group: "management",
    category: "system",
    kind: "runtime",
  },
  AGENT_RUN_REPLAYED_UPLOADS_SEALED: {
    name: "Uploads recorded",
    group: "management",
    category: "system",
    kind: "runtime",
  },
  AGENT_RUN_TOOL_EXPOSURE_CHECKPOINTED: {
    name: "Available tools recorded",
    group: "management",
    category: "system",
    kind: "runtime",
  },
  AGENT_RUN_CONTROL_PLANE_DISPATCH_ACCEPTED: {
    name: "Run dispatch accepted",
    group: "management",
    category: "system",
    kind: "runtime",
  },
  AGENT_RUN_RUNTIME_OWNER_BOUND: {
    name: "Runtime assigned",
    group: "management",
    category: "system",
    kind: "runtime",
  },
  AGENT_RUN_DETACHED_ACCEPTED: {
    name: "Detached run accepted",
    group: "management",
    category: "system",
    kind: "runtime",
  },
  AGENT_RUN_RUNTIME_INVOKE_RETRIED: {
    name: "Runtime call retried",
    group: "management",
    category: "system",
    kind: "runtime",
  },
  AGENT_RUN_CONTEXT_COMPACTED: {
    name: "Context shortened",
    group: "management",
    category: "system",
    kind: "llm",
  },
  AGENT_RUN_PROVIDER_REPLAY_CHECKPOINTED: {
    name: "Replay state saved",
    group: "management",
    category: "system",
    kind: "runtime",
  },
  AGENT_RUN_PROVIDER_REPLAY_TURN_STARTED: {
    name: "Replay turn started",
    group: "management",
    category: "system",
    kind: "runtime",
  },
  AGENT_RUN_PROVIDER_REPLAY_TURN_FINISHED: {
    name: "Replay turn finished",
    group: "management",
    category: "system",
    kind: "runtime",
  },
  AGENT_RUN_INVOKE_AGENT_BILLING_MODE_RETAINED: {
    name: "Billing mode kept",
    group: "billing",
    category: "system",
    kind: "child",
  },
  AGENT_RUN_BILLING_USAGE_RETAINED: {
    name: "Usage kept",
    group: "billing",
    category: "system",
    kind: "runtime",
  },
  RUN_LOG_CAPTURED: {
    name: "Run log recorded",
    group: "diagnostics",
    category: "extensions",
    kind: "output",
  },
  RUNTIME_EVENT_RECORDED: {
    name: "Runtime event recorded",
    group: "diagnostics",
    category: "extensions",
    kind: "runtime",
  },
  STREAM_HEARTBEAT_EMITTED: {
    name: "Stream heartbeat",
    group: "diagnostics",
    category: "extensions",
    kind: "runtime",
  },
  UNKNOWN: { name: "Unknown event", group: "diagnostics", category: "system", kind: "runtime" },
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
 * Stored spellings the API still reads, mapped to their current type: four
 * lowercase-dotted names and the eight pre-rename control-plane names. Rows may
 * still carry them; new rows use the current type.
 */
// legacy: removed in Phase F -- the aliases go when the API stops reading the old spellings.
export const RUN_EVENT_TYPE_ALIASES: Readonly<Record<string, RunEventType>> = Object.freeze({
  "agent_run.request_enqueued": "AGENT_RUN_REQUEST_ENQUEUED",
  "agent_run.default_chat_start_enqueued": "AGENT_RUN_DEFAULT_CHAT_START_ENQUEUED",
  "agent_run.tool_result_submitted": "AGENT_RUN_TOOL_RESULT_SUBMITTED",
  "agent_run.runtime_owner_bound": "AGENT_RUN_RUNTIME_OWNER_BOUND",
  AGENT_RUN_RUNTIME_INVOKE_RETRY: "AGENT_RUN_RUNTIME_INVOKE_RETRIED",
  AGENT_RUN_TOOL_EXPOSURE_CHECKPOINT: "AGENT_RUN_TOOL_EXPOSURE_CHECKPOINTED",
  AGENT_RUN_PROVIDER_REPLAY_CHECKPOINT: "AGENT_RUN_PROVIDER_REPLAY_CHECKPOINTED",
  AGENT_RUN_PROVIDER_REPLAY_TURN_COMPLETE: "AGENT_RUN_PROVIDER_REPLAY_TURN_FINISHED",
  AGENT_RUN_MODEL_CALL_CONTEXT: "AGENT_RUN_MODEL_CALL_CONTEXT_RECORDED",
  AGENT_RUN_CONTROL_PLANE_DISPATCH_RECEIPT: "AGENT_RUN_CONTROL_PLANE_DISPATCH_ACCEPTED",
  AGENT_RUN_INVOKE_AGENT_BILLING_MODE_CHECKPOINT: "AGENT_RUN_INVOKE_AGENT_BILLING_MODE_RETAINED",
  AGENT_RUN_RETAINED_BILLING_USAGE: "AGENT_RUN_BILLING_USAGE_RETAINED",
});

const aliasesByType: ReadonlyMap<string, RunEventType> = new Map(
  Object.entries(RUN_EVENT_TYPE_ALIASES),
);

/**
 * The current type for a stored `event_type`: the type itself when catalogued,
 * its current spelling when it is a legacy alias, or null for a type this build
 * does not know.
 *
 * @example
 * ```ts
 * import { resolveRunEventType } from "veryfront/run-events";
 *
 * resolveRunEventType("AGENT_RUN_MODEL_CALL_CONTEXT"); // "AGENT_RUN_MODEL_CALL_CONTEXT_RECORDED"
 * resolveRunEventType("FUTURE_EVENT"); // null
 * ```
 */
export function resolveRunEventType(type: string): RunEventType | null {
  return definitionsByType.get(type)?.type ?? aliasesByType.get(type) ?? null;
}

/**
 * Look up display metadata without registering a schema validator. A legacy
 * alias resolves to its current type's definition. Returns null for an
 * unrecognized type so callers can display its original name.
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
  const resolved = resolveRunEventType(type);
  return resolved === null ? null : definitionsByType.get(resolved) ?? null;
}

/**
 * The filter category for a stored `event_type`. An unrecognized type reads as
 * `system`, the catch-all, so a type newer than this build never appears as an
 * interaction.
 *
 * @example
 * ```ts
 * import { getRunEventCategory } from "veryfront/run-events";
 *
 * getRunEventCategory("MODEL_CALL_COMPLETED"); // "extensions"
 * getRunEventCategory("FUTURE_EVENT"); // "system"
 * ```
 */
export function getRunEventCategory(type: string): RunEventCategory {
  return getRunEventDefinition(type)?.category ?? "system";
}

/**
 * The semantic kind for a stored `event_type`. An unrecognized type reads as
 * `runtime`.
 *
 * @example
 * ```ts
 * import { getRunEventKind } from "veryfront/run-events";
 *
 * getRunEventKind("MODEL_CALL_COMPLETED"); // "llm"
 * getRunEventKind("FUTURE_EVENT"); // "runtime"
 * ```
 */
export function getRunEventKind(type: string): RunEventKind {
  return getRunEventDefinition(type)?.kind ?? "runtime";
}
