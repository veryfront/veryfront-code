import { computeHash } from "#veryfront/utils/hash-utils.ts";
import { terminalRoute } from "./terminal-route.ts";
import type { Schema } from "#veryfront/extensions/schema/index.ts";
import { createInstrumentedFetch } from "#veryfront/observability/auto-instrument/http-instrumentation.ts";
import { isGlobalTracerProviderInstalled } from "#veryfront/observability/tracing/api-shim.ts";
import { isVeryfrontError, NETWORK_ERROR, TIMEOUT_ERROR } from "#veryfront/errors";
import {
  AppendConversationRunEventsResponseSchema,
  FinalizedCanonicalRunSchema,
} from "./durable-contracts.ts";
import type {
  ActiveConversationRunStatus,
  AppendConversationRunEventsResponse,
  BoundConversationAgentRunFinalizer,
  ConversationRunAppendCursorResyncResult,
  ConversationRunAppendFailureOutcome,
  ConversationRunAppendRecoveryOutcome,
  ConversationRunEventQueueController,
  ConversationRunProjection,
  ConversationRunToolCallAdmissionStart,
  CreateConversationAgentRunInput,
  FinalizeConversationAgentRunInput,
  TerminalConversationRunStatus,
} from "./durable-contracts.ts";
import type { AgentRunModelCallCaptureReceipt } from "#veryfront/runtime/model-call-capture-receipt.ts";
import {
  type AgentRunToolCallAdmissionReceipt,
  getToolCallAdmissionWireReceiptSchema,
} from "#veryfront/runtime/tool-call-admission-receipt.ts";
import {
  AppendConversationRunEventsError,
  isCursorMismatchConversationRunAppendError,
  isIgnorableConversationRunAppendError,
  isPayloadTooLargeConversationRunAppendError,
  isPermanentAuthConversationRunAppendError,
  isTerminalRunConversationRunAppendError,
  parseAppendConversationRunEventsError,
  readAppendCursorHeaders,
} from "./durable-append-errors.ts";

export {
  AppendConversationRunEventsResponseSchema,
  CompleteConversationRunResponseSchema,
  ConversationRunProjectionSchema,
  ConversationRunStatusSchema,
  ConversationRunTargetsSchema,
  CreateConversationRunAcceptedSchema,
  getAppendConversationRunEventsResponseSchema,
  getCompleteConversationRunResponseSchema,
  getConversationRunProjectionSchema,
  getConversationRunStatusSchema,
  getConversationRunTargetsSchema,
  getCreateConversationRunAcceptedSchema,
  resolveConversationRunTargets,
} from "./durable-contracts.ts";
export {
  AppendConversationRunEventsError,
  isCursorMismatchConversationRunAppendError,
  isIgnorableConversationRunAppendError,
  isPermanentAuthConversationRunAppendError,
  parseAppendConversationRunEventsErrorBody,
} from "./durable-append-errors.ts";
import {
  normalizeConversationRunEvent,
  normalizeConversationRunEvents,
} from "./run-event-normalization.ts";
import { MAX_CONVERSATION_RUN_EVENT_APPEND_REQUEST_BYTES } from "./run-event-limits.ts";
import {
  DurableRunEventPersistenceError,
  isPrivateConversationRunEvent,
} from "./private-run-event.ts";
export type {
  ActiveConversationRunStatus,
  AppendConversationRunEventsResponse,
  BoundConversationAgentRunFinalizer,
  ConversationAgentRunUsage,
  ConversationRunAppendCursorResyncResult,
  ConversationRunAppendExecutionOutcome,
  ConversationRunAppendFailureOutcome,
  ConversationRunAppendRecoveryOutcome,
  ConversationRunBatchFlushOutcome,
  ConversationRunEventQueueController,
  ConversationRunProjection,
  ConversationRunQueueFlushOutcome,
  ConversationRunTargets,
  ConversationRunToolCallAdmissionStart,
  CreateConversationAgentRunInput,
  FinalizeConversationAgentRunInput,
  TerminalConversationRunStatus,
} from "./durable-contracts.ts";

const AGENT_RUN_API_TIMEOUT_MS = 15_000;
type ConversationRunApiFetch = typeof globalThis.fetch;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AGENT_RUN_MODEL_CALL_CONTEXT_RECORDED_EVENT_TYPE = "AGENT_RUN_MODEL_CALL_CONTEXT_RECORDED";
const TOOL_CALL_START_EVENT_TYPE = "TOOL_CALL_START";
const IntrinsicReflectApply = Reflect.apply;
const StringPrototypeToLowerCase = String.prototype.toLowerCase;

/**
 * Wrap a trusted transport so durable run persistence stays in the active
 * execution trace. Without an installed tracer provider there is no trace to
 * join, so the transport is returned unchanged and credential-bearing requests
 * never pass through the instrumentation wrapper.
 */
export function instrumentConversationRunFetch(
  fetch: ConversationRunApiFetch,
): ConversationRunApiFetch {
  return isGlobalTracerProviderInstalled() ? createInstrumentedFetch(fetch) : fetch;
}

/**
 * Keep durable run API calls in the same distributed trace as the execution
 * span. The host deliberately does not replace globalThis.fetch, so callers
 * that do not inject a transport must opt into the framework's HTTP wrapper.
 * Explicit transports are host-owned: the trust boundary that pins them wraps
 * them with `instrumentConversationRunFetch` once, so preserving them here
 * avoids double instrumentation.
 */
function resolveConversationRunFetch(fetch?: ConversationRunApiFetch): ConversationRunApiFetch {
  return fetch ?? instrumentConversationRunFetch(globalThis.fetch);
}

function createTimedAbortSignal(timeoutMs: number, abortSignal?: AbortSignal) {
  const controller = new AbortController();
  let abortOrigin: "caller" | "timeout" | null = null;
  const timeout = setTimeout(() => {
    if (abortOrigin) return;
    abortOrigin = "timeout";
    controller.abort(new DOMException("Conversation run API request timed out", "TimeoutError"));
  }, timeoutMs);

  const onAbort = () => {
    if (abortOrigin) return;
    abortOrigin = "caller";
    controller.abort(abortSignal?.reason);
  };

  if (abortSignal?.aborted) {
    onAbort();
  } else {
    abortSignal?.addEventListener("abort", onAbort, { once: true });
  }

  return {
    signal: controller.signal,
    wasAbortedByCaller: () => abortOrigin === "caller",
    cleanup: () => {
      clearTimeout(timeout);
      abortSignal?.removeEventListener("abort", onAbort);
    },
  };
}

const DEFAULT_MAX_CONVERSATION_RUN_BATCH_BYTES = 512 * 1024;

function backfillPurePrivateEventResponseCursor(
  responseBody: unknown,
  latestExternalEventSequence: number,
): unknown {
  if (
    !responseBody || typeof responseBody !== "object" || Array.isArray(responseBody)
  ) {
    return responseBody;
  }

  const body = responseBody as Record<string, unknown>;
  const needsBodyCursor = body.latestExternalEventSequence === undefined &&
    body.latest_external_event_sequence === undefined;
  const run = body.run;
  const runBody = run && typeof run === "object" && !Array.isArray(run)
    ? run as Record<string, unknown>
    : undefined;
  const needsRunCursor = runBody !== undefined &&
    runBody.latestExternalEventSequence === undefined &&
    runBody.latest_external_event_sequence === undefined;

  if (!needsBodyCursor && !needsRunCursor) {
    return responseBody;
  }

  const result = { ...body };
  if (needsBodyCursor) {
    const cursorKey = body.latestEventId !== undefined
      ? "latestExternalEventSequence"
      : "latest_external_event_sequence";
    result[cursorKey] = latestExternalEventSequence;
  }
  if (needsRunCursor && runBody) {
    const runResult = { ...runBody };
    const cursorKey = runBody.latestEventId !== undefined
      ? "latestExternalEventSequence"
      : "latest_external_event_sequence";
    runResult[cursorKey] = latestExternalEventSequence;
    result.run = runResult;
  }
  return result;
}

function readSubmittedModelCallCaptureIds(events: unknown[]): string[] {
  const modelCallIds: string[] = [];

  for (const event of events) {
    if (!isPrivateConversationRunEvent(event) || !event || typeof event !== "object") {
      continue;
    }
    const record = event as Record<string, unknown>;
    if (record.type !== AGENT_RUN_MODEL_CALL_CONTEXT_RECORDED_EVENT_TYPE) {
      continue;
    }
    if (typeof record.modelCallId === "string" && UUID_PATTERN.test(record.modelCallId)) {
      modelCallIds.push(record.modelCallId);
    }
  }

  return modelCallIds;
}

function requireUniqueSubmittedModelCallCaptureIds(modelCallIds: string[]): void {
  const seen = new Set<string>();
  for (const modelCallId of modelCallIds) {
    const key = modelCallId.toLowerCase();
    if (seen.has(key)) {
      throw new DurableRunEventPersistenceError(
        "Duplicate model call capture identity in run event append",
      );
    }
    seen.add(key);
  }
}

function validateAppendModelCallCaptureReceipts(input: {
  response: AppendConversationRunEventsResponse;
  submittedModelCallIds: string[];
  canonicalRunId: string;
}): void {
  const expectedIds = new Set(input.submittedModelCallIds.map((id) => id.toLowerCase()));
  const receipts = input.response.modelCallCaptures ?? [];

  if (expectedIds.size === 0) {
    if (receipts.length > 0) {
      throw new DurableRunEventPersistenceError(
        "Append receipt returned model call captures for an append without submitted captures",
      );
    }
    return;
  }

  if (input.response.modelCallCaptures === undefined) {
    throw new DurableRunEventPersistenceError(
      "Append receipt is missing model call capture acknowledgements",
    );
  }

  if (receipts.length !== expectedIds.size) {
    throw new DurableRunEventPersistenceError(
      "Append receipt model call capture acknowledgement count does not match the submitted captures",
    );
  }

  const receivedIds = new Set<string>();
  const receivedEventIds = new Set<string>();
  const canonicalRunId = input.canonicalRunId.toLowerCase();
  for (const receipt of receipts) {
    const modelCallId = receipt.modelCallId.toLowerCase();
    if (receivedEventIds.has(receipt.eventId)) {
      throw new DurableRunEventPersistenceError(
        "Append receipt returned duplicate model call capture event identifiers",
      );
    }
    receivedEventIds.add(receipt.eventId);
    if (receipt.runId.toLowerCase() !== canonicalRunId) {
      throw new DurableRunEventPersistenceError(
        "Append receipt model call capture identifies a different canonical run",
      );
    }
    if (!expectedIds.has(modelCallId)) {
      throw new DurableRunEventPersistenceError(
        "Append receipt model call capture does not match a submitted capture",
      );
    }
    if (receivedIds.has(modelCallId)) {
      throw new DurableRunEventPersistenceError(
        "Append receipt returned duplicate model call capture acknowledgements",
      );
    }
    receivedIds.add(modelCallId);
  }

  for (const modelCallId of expectedIds) {
    if (!receivedIds.has(modelCallId)) {
      throw new DurableRunEventPersistenceError(
        "Append receipt is missing a submitted model call capture acknowledgement",
      );
    }
  }
}

interface SubmittedToolCallAdmissionStart {
  occurrenceId: string;
  eventIndex: number;
  toolCallId: string;
}

function isToolCallStartEvent(value: unknown): value is { toolCallId: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return record.type === TOOL_CALL_START_EVENT_TYPE &&
    typeof record.toolCallId === "string" &&
    record.toolCallId.length > 0;
}

function readSubmittedToolCallAdmissionStarts(input: {
  events: unknown[];
  toolCallStarts?: ConversationRunToolCallAdmissionStart[];
}): SubmittedToolCallAdmissionStart[] {
  if (!input.toolCallStarts || input.toolCallStarts.length === 0) {
    return [];
  }

  const seenOccurrences = new Set<string>();
  const seenEventIndexes = new Set<number>();
  const submitted: SubmittedToolCallAdmissionStart[] = [];

  for (const start of input.toolCallStarts) {
    if (!UUID_PATTERN.test(start.occurrenceId)) {
      throw new DurableRunEventPersistenceError(
        "Tool call admission sidecar occurrence_id must be a UUID",
      );
    }
    if (!Number.isInteger(start.eventIndex) || start.eventIndex < 0) {
      throw new DurableRunEventPersistenceError(
        "Tool call admission sidecar event_index must select an event in the append",
      );
    }
    if (seenEventIndexes.has(start.eventIndex)) {
      throw new DurableRunEventPersistenceError(
        "Tool call admission sidecar references the same event more than once",
      );
    }
    seenEventIndexes.add(start.eventIndex);

    const event = input.events[start.eventIndex];
    if (!isToolCallStartEvent(event)) {
      throw new DurableRunEventPersistenceError(
        "Tool call admission sidecar event_index must select a TOOL_CALL_START event",
      );
    }

    const occurrenceId = start.occurrenceId.toLowerCase();
    if (seenOccurrences.has(occurrenceId)) {
      throw new DurableRunEventPersistenceError(
        "Tool call admission sidecar contains duplicate occurrence_id values",
      );
    }
    seenOccurrences.add(occurrenceId);
    submitted.push({
      occurrenceId,
      eventIndex: start.eventIndex,
      toolCallId: event.toolCallId,
    });
  }

  return submitted;
}

function toWireToolCallAdmissionStarts(
  starts: SubmittedToolCallAdmissionStart[],
): Array<{ occurrence_id: string; event_index: number }> {
  return starts.map((start) => ({
    occurrence_id: start.occurrenceId,
    event_index: start.eventIndex,
  }));
}

function validateAppendToolCallAdmissionReceipts(input: {
  response: AppendConversationRunEventsResponse;
  submittedStarts: SubmittedToolCallAdmissionStart[];
  canonicalRunId: string;
}): void {
  const expectedByOccurrence = new Map<string, SubmittedToolCallAdmissionStart>();
  for (const start of input.submittedStarts) {
    expectedByOccurrence.set(start.occurrenceId, start);
  }

  const receipts = input.response.toolCallAdmissions ?? [];
  if (expectedByOccurrence.size === 0) {
    if (receipts.length > 0) {
      throw new DurableRunEventPersistenceError(
        "Append receipt returned tool call admissions for an append without submitted starts",
      );
    }
    return;
  }

  if (input.response.toolCallAdmissions === undefined) {
    throw new DurableRunEventPersistenceError(
      "Append receipt is missing tool call admission acknowledgements",
    );
  }

  if (receipts.length !== expectedByOccurrence.size) {
    throw new DurableRunEventPersistenceError(
      "Append receipt tool call admission acknowledgement count does not match the submitted starts",
    );
  }

  const seenOccurrences = new Set<string>();
  const seenDurableEventIds = new Set<string>();
  const canonicalRunId = input.canonicalRunId.toLowerCase();

  for (const receipt of receipts) {
    const occurrenceId = receipt.occurrenceId.toLowerCase();
    const submitted = expectedByOccurrence.get(occurrenceId);
    if (!submitted) {
      throw new DurableRunEventPersistenceError(
        "Append receipt tool call admission does not match a submitted occurrence",
      );
    }
    if (seenOccurrences.has(occurrenceId)) {
      throw new DurableRunEventPersistenceError(
        "Append receipt returned duplicate tool call admission occurrences",
      );
    }
    seenOccurrences.add(occurrenceId);

    if (receipt.runId.toLowerCase() !== canonicalRunId) {
      throw new DurableRunEventPersistenceError(
        "Append receipt tool call admission identifies a different canonical run",
      );
    }
    if (receipt.toolCallId !== submitted.toolCallId) {
      throw new DurableRunEventPersistenceError(
        "Append receipt tool call admission does not match the submitted tool call",
      );
    }
    if (receipt.admissionEventId === receipt.startEventId) {
      throw new DurableRunEventPersistenceError(
        "Append receipt tool call admission reuses one durable event identifier",
      );
    }
    if (seenDurableEventIds.has(receipt.admissionEventId)) {
      throw new DurableRunEventPersistenceError(
        "Append receipt returned duplicate tool call durable event identifiers",
      );
    }
    seenDurableEventIds.add(receipt.admissionEventId);
    if (seenDurableEventIds.has(receipt.startEventId)) {
      throw new DurableRunEventPersistenceError(
        "Append receipt returned duplicate tool call durable event identifiers",
      );
    }
    seenDurableEventIds.add(receipt.startEventId);
  }
}

function shiftToolCallAdmissionStarts(
  starts: ConversationRunToolCallAdmissionStart[] | undefined,
  offset: number,
): ConversationRunToolCallAdmissionStart[] {
  if (!starts || starts.length === 0) {
    return [];
  }
  return starts.map((start) => ({
    occurrenceId: start.occurrenceId,
    eventIndex: start.eventIndex + offset,
  }));
}

function selectToolCallAdmissionStartsForRange(input: {
  starts?: ConversationRunToolCallAdmissionStart[];
  startIndex: number;
  eventCount: number;
}): ConversationRunToolCallAdmissionStart[] {
  if (!input.starts || input.starts.length === 0) {
    return [];
  }
  const endIndex = input.startIndex + input.eventCount;
  return input.starts
    .filter((start) => start.eventIndex >= input.startIndex && start.eventIndex < endIndex)
    .map((start) => ({
      occurrenceId: start.occurrenceId,
      eventIndex: start.eventIndex - input.startIndex,
    }));
}

function normalizeAppendEvents(input: {
  events: unknown[];
  hasToolCallAdmissionStarts: boolean;
}): unknown[] {
  if (!input.hasToolCallAdmissionStarts) {
    return normalizeConversationRunEvents(
      input.events as Parameters<typeof normalizeConversationRunEvents>[0],
    );
  }

  const normalizedEvents: unknown[] = [];
  for (const event of input.events) {
    const normalized = normalizeConversationRunEvent(
      event as Parameters<typeof normalizeConversationRunEvent>[0],
    );
    if (normalized.length !== 1) {
      throw new DurableRunEventPersistenceError(
        "Tool call admission sidecar requires stable event indexes after normalization",
      );
    }
    normalizedEvents.push(normalized[0]);
  }
  return normalizedEvents;
}

/** Error shape for conversation run terminal state. */
export class ConversationRunTerminalStateError extends Error {
  readonly status: TerminalConversationRunStatus;
  readonly run: Pick<ConversationRunProjection, "runId" | "status">;

  constructor(
    run: Pick<ConversationRunProjection, "runId" | "status">,
    status: TerminalConversationRunStatus,
  ) {
    super(`Conversation run ${run.runId} became ${status} before host execution finished`);
    this.name = "ConversationRunTerminalStateError";
    this.status = status;
    this.run = run;
  }
}

/** Check whether a conversation run status is active. */
export function isActiveConversationRunStatus(
  status: ConversationRunProjection["status"],
): status is ActiveConversationRunStatus {
  return status === "pending" || status === "running" || status === "waiting_for_tool";
}

/** Check whether a conversation run projection can accept more events. */
export function isAppendableConversationRunProjection(run: ConversationRunProjection): boolean {
  return (
    run.status !== "completed" &&
    run.status !== "failed" &&
    run.status !== "cancelled" &&
    run.status !== "waiting_for_tool" &&
    run.waitingToolCallId === null &&
    run.waitingToolName === null
  );
}

/**
 * The run reached a terminal status server-side. Both this and a `waiting_for_tool`
 * projection are non-appendable, but only this one means the run can never be
 * completed either, so the two must not share a stop reason
 * (veryfront-issue-inbox#743).
 */
export function isTerminalConversationRunProjection(run: ConversationRunProjection): boolean {
  return (
    run.status === "completed" ||
    run.status === "failed" ||
    run.status === "cancelled"
  );
}

/** @deprecated Use authenticated append receipts and cursor mismatch headers. */
export async function resyncConversationRunAppendCursor(input: {
  authToken: string;
  apiUrl: string;
  conversationId: string;
  runId: string;
  previousLatestExternalEventSequence: number;
  abortSignal?: AbortSignal;
  /** Host-owned transport used by trusted capability-backed callers. */
  fetch?: ConversationRunApiFetch;
}): Promise<{
  result: ConversationRunAppendCursorResyncResult;
  run: ConversationRunProjection;
}> {
  const run = await getConversationRun({
    authToken: input.authToken,
    apiUrl: input.apiUrl,
    conversationId: input.conversationId,
    runId: input.runId,
    abortSignal: input.abortSignal,
    fetch: input.fetch,
  });

  if (!isAppendableConversationRunProjection(run)) {
    return {
      result: "non_appendable",
      run,
    };
  }

  if (run.latestExternalEventSequence > input.previousLatestExternalEventSequence) {
    return {
      result: "advanced",
      run,
    };
  }

  return {
    result: "unchanged",
    run,
  };
}

/** Recover conversation run cursor mismatch helper. */
export async function recoverConversationRunCursorMismatch(input: {
  error: unknown;
  authToken: string;
  apiUrl: string;
  conversationId: string;
  runId: string;
  latestEventId: number;
  latestExternalEventSequence: number;
  cursorResyncsThisFlush: number;
  maxCursorResyncsPerFlush: number;
  cursorMode?: "external_sequence" | "durable_event_id";
  abortSignal?: AbortSignal;
  /** Host-owned transport used by trusted capability-backed callers. */
  fetch?: ConversationRunApiFetch;
}): Promise<{
  outcome: ConversationRunAppendRecoveryOutcome;
  latestEventId: number;
  latestExternalEventSequence: number;
  disableReason?:
    | "cursor_resyncs_exhausted"
    | "cursor_mismatch_ambiguous"
    | "non_appendable"
    | "run_terminal";
  run?: ConversationRunProjection;
}> {
  if (!isCursorMismatchConversationRunAppendError(input.error)) {
    return {
      outcome: "bubbled",
      latestEventId: input.latestEventId,
      latestExternalEventSequence: input.latestExternalEventSequence,
    };
  }

  // Durable-ID batches are replayed only when the append endpoint itself proves
  // exact replay or a committed prefix and returns 200. A cursor mismatch is
  // therefore ambiguous and must never resync to the latest projection, which
  // could duplicate a partially committed context after unrelated events.
  if (input.cursorMode === "durable_event_id") {
    return {
      outcome: "stopped",
      latestEventId: input.latestEventId,
      latestExternalEventSequence: input.latestExternalEventSequence,
      disableReason: "cursor_mismatch_ambiguous",
    };
  }

  if (input.cursorResyncsThisFlush >= input.maxCursorResyncsPerFlush) {
    return {
      outcome: "stopped",
      latestEventId: input.latestEventId,
      latestExternalEventSequence: input.latestExternalEventSequence,
      disableReason: "cursor_resyncs_exhausted",
    };
  }

  const cursor = input.error.cursor;
  if (
    cursor && cursor.latestEventId >= input.latestEventId &&
    cursor.latestExternalEventSequence > input.latestExternalEventSequence
  ) {
    return { outcome: "resumed", ...cursor };
  }
  // A missing or stale hint is not permission to read through an append-only token,
  // nor evidence that an ambiguous batch can be safely replayed.
  return {
    outcome: "stopped",
    latestEventId: input.latestEventId,
    latestExternalEventSequence: input.latestExternalEventSequence,
    disableReason: "cursor_mismatch_ambiguous",
  };
}

/** Recover conversation run append failure helper. */
export async function recoverConversationRunAppendFailure(input: {
  error: unknown;
  authToken: string;
  apiUrl: string;
  conversationId: string;
  runId: string;
  latestEventId: number;
  latestExternalEventSequence: number;
  cursorResyncsThisFlush: number;
  maxCursorResyncsPerFlush: number;
  cursorMode?: "external_sequence" | "durable_event_id";
  abortSignal?: AbortSignal;
  /** Host-owned transport used by trusted capability-backed callers. */
  fetch?: ConversationRunApiFetch;
}): Promise<{
  outcome: ConversationRunAppendFailureOutcome;
  latestEventId: number;
  latestExternalEventSequence: number;
  disableReason?:
    | "cursor_resyncs_exhausted"
    | "cursor_mismatch_ambiguous"
    | "non_appendable"
    | "ignorable_append_rejection"
    | "run_terminal"
    | "payload_too_large"
    | "auth_rejected";
  errorMessage?: string;
  retryCause?: "timeout";
  run?: ConversationRunProjection;
}> {
  const cursorRecovery = await recoverConversationRunCursorMismatch({
    error: input.error,
    authToken: input.authToken,
    apiUrl: input.apiUrl,
    conversationId: input.conversationId,
    runId: input.runId,
    latestEventId: input.latestEventId,
    latestExternalEventSequence: input.latestExternalEventSequence,
    cursorResyncsThisFlush: input.cursorResyncsThisFlush,
    maxCursorResyncsPerFlush: input.maxCursorResyncsPerFlush,
    cursorMode: input.cursorMode,
    abortSignal: input.abortSignal,
    fetch: input.fetch,
  });

  if (cursorRecovery.outcome === "resumed") {
    return {
      outcome: "resumed",
      latestEventId: cursorRecovery.latestEventId,
      latestExternalEventSequence: cursorRecovery.latestExternalEventSequence,
      ...(cursorRecovery.run ? { run: cursorRecovery.run } : {}),
    };
  }

  if (cursorRecovery.outcome === "stopped") {
    return {
      outcome: "stopped",
      latestEventId: cursorRecovery.latestEventId,
      latestExternalEventSequence: cursorRecovery.latestExternalEventSequence,
      disableReason: cursorRecovery.disableReason,
      ...(cursorRecovery.run ? { run: cursorRecovery.run } : {}),
    };
  }

  // veryfront-issue-inbox#743: a terminal-run rejection is the API telling the
  // runtime the run is finished and its row may already be gone (a project delete
  // cancels its in-flight runs first). Classify it distinctly from the other
  // ignorable rejections so finalization can skip completing a run that can only
  // 400 -- other missing-resource responses and runs waiting for a tool result
  // keep the generic stop; every other rejection must still retry or surface.
  if (isTerminalRunConversationRunAppendError(input.error)) {
    return {
      outcome: "stopped",
      latestEventId: cursorRecovery.latestEventId,
      latestExternalEventSequence: cursorRecovery.latestExternalEventSequence,
      disableReason: "run_terminal",
      ...(cursorRecovery.run ? { run: cursorRecovery.run } : {}),
    };
  }

  if (isIgnorableConversationRunAppendError(input.error)) {
    return {
      outcome: "stopped",
      latestEventId: cursorRecovery.latestEventId,
      latestExternalEventSequence: cursorRecovery.latestExternalEventSequence,
      disableReason: "ignorable_append_rejection",
      ...(cursorRecovery.run ? { run: cursorRecovery.run } : {}),
    };
  }

  if (isPermanentAuthConversationRunAppendError(input.error)) {
    return {
      outcome: "stopped",
      latestEventId: cursorRecovery.latestEventId,
      latestExternalEventSequence: cursorRecovery.latestExternalEventSequence,
      disableReason: "auth_rejected",
      ...(cursorRecovery.run ? { run: cursorRecovery.run } : {}),
    };
  }

  // Permanent: the same bytes fail every retry. Stop instead of retry-storming the
  // API (the runtime normalizes under the limit before appending, so this is a bug).
  if (isPayloadTooLargeConversationRunAppendError(input.error)) {
    return {
      outcome: "stopped",
      latestEventId: cursorRecovery.latestEventId,
      latestExternalEventSequence: cursorRecovery.latestExternalEventSequence,
      disableReason: "payload_too_large",
      ...(cursorRecovery.run ? { run: cursorRecovery.run } : {}),
    };
  }

  return {
    outcome: "retry_scheduled",
    latestEventId: cursorRecovery.latestEventId,
    latestExternalEventSequence: cursorRecovery.latestExternalEventSequence,
    errorMessage: input.error instanceof Error ? input.error.message : String(input.error),
    ...(isVeryfrontError(input.error) && input.error.slug === "timeout-error"
      ? { retryCause: "timeout" as const }
      : {}),
    ...(cursorRecovery.run ? { run: cursorRecovery.run } : {}),
  };
}

/** Recover conversation run append execution helper. */
export async function recoverConversationRunAppendExecution(input: {
  error: unknown;
  authToken: string;
  apiUrl: string;
  conversationId: string;
  runId: string;
  latestEventId: number;
  latestExternalEventSequence: number;
  remainingEvents: unknown[];
  pendingEvents: unknown[];
  remainingToolCallStarts?: ConversationRunToolCallAdmissionStart[];
  pendingToolCallStarts?: ConversationRunToolCallAdmissionStart[];
  cursorResyncsThisFlush: number;
  consecutiveFailures: number;
  maxCursorResyncsPerFlush: number;
  cursorMode?: "external_sequence" | "durable_event_id";
  abortSignal?: AbortSignal;
  /** Host-owned transport used by trusted capability-backed callers. */
  fetch?: ConversationRunApiFetch;
}): Promise<
  | {
    outcome: "resumed";
    latestEventId: number;
    latestExternalEventSequence: number;
    pendingEvents: unknown[];
    pendingToolCallStarts?: ConversationRunToolCallAdmissionStart[];
    consecutiveFailures: number;
  }
  | {
    outcome: "stopped";
    latestEventId: number;
    latestExternalEventSequence: number;
    disableReason?:
      | "cursor_resyncs_exhausted"
      | "cursor_mismatch_ambiguous"
      | "non_appendable"
      | "ignorable_append_rejection"
      | "run_terminal"
      | "payload_too_large"
      | "auth_rejected";
  }
  | {
    outcome: "retry_scheduled";
    latestEventId: number;
    latestExternalEventSequence: number;
    pendingEvents: unknown[];
    pendingToolCallStarts?: ConversationRunToolCallAdmissionStart[];
    consecutiveFailures: number;
    errorMessage: string;
    retryCause?: "timeout";
  }
> {
  const recovered = await recoverConversationRunAppendFailure({
    error: input.error,
    authToken: input.authToken,
    apiUrl: input.apiUrl,
    conversationId: input.conversationId,
    runId: input.runId,
    latestEventId: input.latestEventId,
    latestExternalEventSequence: input.latestExternalEventSequence,
    cursorResyncsThisFlush: input.cursorResyncsThisFlush,
    maxCursorResyncsPerFlush: input.maxCursorResyncsPerFlush,
    cursorMode: input.cursorMode,
    abortSignal: input.abortSignal,
    fetch: input.fetch,
  });

  const pendingToolCallStarts = [
    ...(input.remainingToolCallStarts ?? []),
    ...shiftToolCallAdmissionStarts(input.pendingToolCallStarts, input.remainingEvents.length),
  ];

  if (recovered.outcome === "resumed") {
    return {
      outcome: "resumed",
      latestEventId: recovered.latestEventId,
      latestExternalEventSequence: recovered.latestExternalEventSequence,
      pendingEvents: [...input.remainingEvents, ...input.pendingEvents],
      ...(pendingToolCallStarts.length > 0 ? { pendingToolCallStarts } : {}),
      consecutiveFailures: 0,
    };
  }

  if (recovered.outcome === "stopped") {
    return {
      outcome: "stopped",
      latestEventId: recovered.latestEventId,
      latestExternalEventSequence: recovered.latestExternalEventSequence,
      ...(recovered.disableReason ? { disableReason: recovered.disableReason } : {}),
    };
  }

  return {
    outcome: "retry_scheduled",
    latestEventId: recovered.latestEventId,
    latestExternalEventSequence: recovered.latestExternalEventSequence,
    pendingEvents: [...input.remainingEvents, ...input.pendingEvents],
    ...(pendingToolCallStarts.length > 0 ? { pendingToolCallStarts } : {}),
    consecutiveFailures: input.consecutiveFailures + 1,
    errorMessage: recovered.errorMessage ?? "Conversation run append failed",
    ...(recovered.retryCause ? { retryCause: recovered.retryCause } : {}),
  };
}

function getConversationRunEventJsonByteLength(event: unknown): number {
  return new TextEncoder().encode(JSON.stringify(event)).byteLength;
}

function buildConversationRunEventBatches(input: {
  events: unknown[];
  maxEventsPerBatch: number;
  maxBatchPayloadBytes?: number;
}): unknown[][] {
  const maxBatchPayloadBytes = input.maxBatchPayloadBytes ??
    DEFAULT_MAX_CONVERSATION_RUN_BATCH_BYTES;
  const batches: unknown[][] = [];
  let currentBatch: unknown[] = [];
  let currentBatchBytes = 0;

  for (const event of input.events) {
    const eventBytes = getConversationRunEventJsonByteLength(event);

    if (
      currentBatch.length > 0 &&
      (currentBatch.length >= input.maxEventsPerBatch ||
        currentBatchBytes + eventBytes > maxBatchPayloadBytes)
    ) {
      batches.push(currentBatch);
      currentBatch = [];
      currentBatchBytes = 0;
    }

    currentBatch.push(event);
    currentBatchBytes += eventBytes;
  }

  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }

  return batches;
}

/** Flush conversation run event batches. */
export async function flushConversationRunEventBatches(input: {
  authToken: string;
  apiUrl: string;
  conversationId: string;
  runId: string;
  canonicalRunId?: string;
  latestEventId: number;
  latestExternalEventSequence: number;
  events: unknown[];
  toolCallStarts?: ConversationRunToolCallAdmissionStart[];
  pendingEvents?: unknown[];
  pendingToolCallStarts?: ConversationRunToolCallAdmissionStart[];
  maxEventsPerBatch: number;
  maxBatchPayloadBytes?: number;
  cursorResyncsThisFlush?: number;
  consecutiveFailures?: number;
  maxCursorResyncsPerFlush: number;
  abortSignal?: AbortSignal;
  onAppendRequest?: () => void;
  onModelCallCaptureReceipts?: (receipts: AgentRunModelCallCaptureReceipt[]) => void;
  onToolCallAdmissionReceipts?: (receipts: AgentRunToolCallAdmissionReceipt[]) => void;
  /** Host-owned transport used by trusted capability-backed callers. */
  fetch?: ConversationRunApiFetch;
}): Promise<
  | {
    outcome: "flushed";
    latestEventId: number;
    latestExternalEventSequence: number;
  }
  | {
    outcome: "resumed" | "retry_scheduled";
    latestEventId: number;
    latestExternalEventSequence: number;
    pendingEvents: unknown[];
    pendingToolCallStarts?: ConversationRunToolCallAdmissionStart[];
    consecutiveFailures: number;
    errorMessage?: string;
    retryCause?: "timeout";
  }
  | {
    outcome: "stopped";
    latestEventId: number;
    latestExternalEventSequence: number;
    disableReason?:
      | "cursor_resyncs_exhausted"
      | "cursor_mismatch_ambiguous"
      | "non_appendable"
      | "ignorable_append_rejection"
      | "run_terminal"
      | "payload_too_large"
      | "auth_rejected";
  }
> {
  const batches = buildConversationRunEventBatches({
    events: input.events,
    maxEventsPerBatch: input.maxEventsPerBatch,
    maxBatchPayloadBytes: input.maxBatchPayloadBytes,
  });

  let latestEventId = input.latestEventId;
  let latestExternalEventSequence = input.latestExternalEventSequence;
  let batchStartIndex = 0;

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
    input.abortSignal?.throwIfAborted();
    const batch = batches[batchIndex];
    if (!batch) {
      continue;
    }
    const cursorMode = batch.some(isPrivateConversationRunEvent)
      ? "durable_event_id" as const
      : "external_sequence" as const;
    const batchToolCallStarts = selectToolCallAdmissionStartsForRange({
      starts: input.toolCallStarts,
      startIndex: batchStartIndex,
      eventCount: batch.length,
    });
    try {
      input.onAppendRequest?.();
      const response = await appendConversationRunEvents({
        authToken: input.authToken,
        apiUrl: input.apiUrl,
        conversationId: input.conversationId,
        runId: input.runId,
        canonicalRunId: input.canonicalRunId,
        ...(cursorMode === "durable_event_id" ? { expectedPreviousEventId: latestEventId } : {}),
        expectedPreviousExternalEventSequence: latestExternalEventSequence,
        events: batch,
        toolCallStarts: batchToolCallStarts,
        abortSignal: input.abortSignal,
        fetch: input.fetch,
      });
      if (response.modelCallCaptures && response.modelCallCaptures.length > 0) {
        input.onModelCallCaptureReceipts?.(response.modelCallCaptures);
      }
      if (response.toolCallAdmissions && response.toolCallAdmissions.length > 0) {
        input.onToolCallAdmissionReceipts?.(response.toolCallAdmissions);
      }
      latestEventId = response.latestEventId;
      latestExternalEventSequence = response.latestExternalEventSequence;
      batchStartIndex += batch.length;
    } catch (error) {
      input.abortSignal?.throwIfAborted();
      const remainingEvents = batches.slice(batchIndex).flat();
      const remainingToolCallStarts = selectToolCallAdmissionStartsForRange({
        starts: input.toolCallStarts,
        startIndex: batchStartIndex,
        eventCount: remainingEvents.length,
      });
      const recovered = await recoverConversationRunAppendExecution({
        error,
        authToken: input.authToken,
        apiUrl: input.apiUrl,
        conversationId: input.conversationId,
        runId: input.runId,
        latestEventId,
        latestExternalEventSequence,
        remainingEvents,
        pendingEvents: input.pendingEvents ?? [],
        remainingToolCallStarts,
        pendingToolCallStarts: input.pendingToolCallStarts,
        cursorResyncsThisFlush: input.cursorResyncsThisFlush ?? 0,
        consecutiveFailures: input.consecutiveFailures ?? 0,
        maxCursorResyncsPerFlush: input.maxCursorResyncsPerFlush,
        cursorMode,
        abortSignal: input.abortSignal,
        fetch: input.fetch,
      });

      if (recovered.outcome === "stopped") {
        return {
          outcome: "stopped",
          latestEventId: recovered.latestEventId,
          latestExternalEventSequence: recovered.latestExternalEventSequence,
          ...(recovered.disableReason ? { disableReason: recovered.disableReason } : {}),
        };
      }

      return {
        outcome: recovered.outcome,
        latestEventId: recovered.latestEventId,
        latestExternalEventSequence: recovered.latestExternalEventSequence,
        pendingEvents: recovered.pendingEvents,
        ...(recovered.pendingToolCallStarts && recovered.pendingToolCallStarts.length > 0
          ? { pendingToolCallStarts: recovered.pendingToolCallStarts }
          : {}),
        consecutiveFailures: recovered.consecutiveFailures,
        ...(recovered.outcome === "retry_scheduled"
          ? {
            errorMessage: recovered.errorMessage,
            ...(recovered.retryCause ? { retryCause: recovered.retryCause } : {}),
          }
          : {}),
      };
    }
  }

  return {
    outcome: "flushed",
    latestEventId,
    latestExternalEventSequence,
  };
}

/** Flush conversation run event queue. */
export async function flushConversationRunEventQueue(input: {
  authToken: string;
  apiUrl: string;
  conversationId: string;
  runId: string;
  canonicalRunId?: string;
  latestEventId: number;
  latestExternalEventSequence: number;
  events: unknown[];
  toolCallStarts?: ConversationRunToolCallAdmissionStart[];
  maxEventsPerBatch: number;
  maxBatchPayloadBytes?: number;
  maxCursorResyncsPerFlush: number;
  consecutiveFailures?: number;
  abortSignal?: AbortSignal;
  onAppendRequest?: () => void;
  onModelCallCaptureReceipts?: (receipts: AgentRunModelCallCaptureReceipt[]) => void;
  onToolCallAdmissionReceipts?: (receipts: AgentRunToolCallAdmissionReceipt[]) => void;
  /** Host-owned transport used by trusted capability-backed callers. */
  fetch?: ConversationRunApiFetch;
}): Promise<
  | {
    outcome: "flushed";
    latestEventId: number;
    latestExternalEventSequence: number;
  }
  | {
    outcome: "stopped";
    latestEventId: number;
    latestExternalEventSequence: number;
    disableReason?:
      | "cursor_resyncs_exhausted"
      | "cursor_mismatch_ambiguous"
      | "non_appendable"
      | "ignorable_append_rejection"
      | "run_terminal"
      | "payload_too_large"
      | "auth_rejected";
  }
  | {
    outcome: "retry_scheduled";
    latestEventId: number;
    latestExternalEventSequence: number;
    pendingEvents: unknown[];
    pendingToolCallStarts?: ConversationRunToolCallAdmissionStart[];
    consecutiveFailures: number;
    errorMessage: string;
    retryCause?: "timeout";
  }
> {
  let latestEventId = input.latestEventId;
  let latestExternalEventSequence = input.latestExternalEventSequence;
  let pendingEvents = [...input.events];
  let pendingToolCallStarts = input.toolCallStarts ?? [];
  let cursorResyncsThisFlush = 0;
  let consecutiveFailures = input.consecutiveFailures ?? 0;

  while (pendingEvents.length > 0) {
    const events = pendingEvents;
    const toolCallStarts = pendingToolCallStarts;
    pendingEvents = [];
    pendingToolCallStarts = [];

    const flushed = await flushConversationRunEventBatches({
      authToken: input.authToken,
      apiUrl: input.apiUrl,
      conversationId: input.conversationId,
      runId: input.runId,
      canonicalRunId: input.canonicalRunId,
      latestEventId,
      latestExternalEventSequence,
      events,
      toolCallStarts,
      pendingEvents,
      pendingToolCallStarts,
      maxEventsPerBatch: input.maxEventsPerBatch,
      maxBatchPayloadBytes: input.maxBatchPayloadBytes,
      cursorResyncsThisFlush,
      consecutiveFailures,
      maxCursorResyncsPerFlush: input.maxCursorResyncsPerFlush,
      abortSignal: input.abortSignal,
      onAppendRequest: input.onAppendRequest,
      onModelCallCaptureReceipts: input.onModelCallCaptureReceipts,
      onToolCallAdmissionReceipts: input.onToolCallAdmissionReceipts,
      fetch: input.fetch,
    });

    latestEventId = flushed.latestEventId;
    latestExternalEventSequence = flushed.latestExternalEventSequence;

    if (flushed.outcome === "flushed") {
      consecutiveFailures = 0;
      continue;
    }

    if (flushed.outcome === "resumed") {
      pendingEvents = flushed.pendingEvents;
      pendingToolCallStarts = flushed.pendingToolCallStarts ?? [];
      consecutiveFailures = flushed.consecutiveFailures;
      cursorResyncsThisFlush += 1;
      continue;
    }

    if (flushed.outcome === "stopped") {
      return {
        outcome: "stopped",
        latestEventId: flushed.latestEventId,
        latestExternalEventSequence: flushed.latestExternalEventSequence,
        ...(flushed.disableReason ? { disableReason: flushed.disableReason } : {}),
      };
    }

    return {
      outcome: "retry_scheduled",
      latestEventId: flushed.latestEventId,
      latestExternalEventSequence: flushed.latestExternalEventSequence,
      pendingEvents: flushed.pendingEvents,
      ...(flushed.pendingToolCallStarts && flushed.pendingToolCallStarts.length > 0
        ? { pendingToolCallStarts: flushed.pendingToolCallStarts }
        : {}),
      consecutiveFailures: flushed.consecutiveFailures,
      errorMessage: flushed.errorMessage ?? "Conversation run append failed",
      ...(flushed.retryCause ? { retryCause: flushed.retryCause } : {}),
    };
  }

  return {
    outcome: "flushed",
    latestEventId,
    latestExternalEventSequence,
  };
}

/** Create conversation run event queue controller. */
export function createConversationRunEventQueueController(input: {
  authToken: string;
  apiUrl: string;
  conversationId: string;
  runId: string;
  canonicalRunId?: string;
  latestEventId: number;
  latestExternalEventSequence: number;
  maxEventsPerBatch: number;
  maxBatchPayloadBytes?: number;
  maxCursorResyncsPerFlush?: number;
  /** Host-owned transport used by trusted capability-backed callers. */
  fetch?: ConversationRunApiFetch;
}): ConversationRunEventQueueController {
  let latestEventId = input.latestEventId;
  let latestExternalEventSequence = input.latestExternalEventSequence;
  let pendingEvents: unknown[] = [];
  let pendingToolCallStarts: ConversationRunToolCallAdmissionStart[] = [];
  let consecutiveFailures = 0;
  let disabled = false;
  let disposed = false;
  let appendRequestCount = 0;
  const modelCallCaptureReceipts = new Map<string, AgentRunModelCallCaptureReceipt>();
  const toolCallAdmissionReceipts = new Map<string, AgentRunToolCallAdmissionReceipt>();
  let disableReason: ReturnType<
    ConversationRunEventQueueController["getSnapshot"]
  >["disableReason"];
  let flushTail: Promise<unknown> | null = null;

  function storeModelCallCaptureReceipts(receipts: AgentRunModelCallCaptureReceipt[]): void {
    for (const receipt of receipts) {
      const key = receipt.modelCallId.toLowerCase();
      const existing = modelCallCaptureReceipts.get(key);
      if (existing) {
        if (
          existing.eventId === receipt.eventId &&
          existing.projectId.toLowerCase() === receipt.projectId.toLowerCase() &&
          existing.runId.toLowerCase() === receipt.runId.toLowerCase()
        ) {
          continue;
        }
        throw new DurableRunEventPersistenceError(
          "Conflicting model call capture acknowledgement for already acknowledged call",
        );
      }
      modelCallCaptureReceipts.set(key, receipt);
    }
  }

  function storeToolCallAdmissionReceipts(receipts: AgentRunToolCallAdmissionReceipt[]): void {
    for (const receipt of receipts) {
      const key = receipt.occurrenceId.toLowerCase();
      const existing = toolCallAdmissionReceipts.get(key);
      if (existing) {
        if (
          existing.admissionEventId === receipt.admissionEventId &&
          existing.startEventId === receipt.startEventId &&
          existing.toolCallId === receipt.toolCallId &&
          existing.publicToolCallId === receipt.publicToolCallId &&
          existing.projectId.toLowerCase() === receipt.projectId.toLowerCase() &&
          existing.runId.toLowerCase() === receipt.runId.toLowerCase()
        ) {
          continue;
        }
        throw new DurableRunEventPersistenceError(
          "Conflicting tool call admission acknowledgement for already acknowledged occurrence",
        );
      }
      toolCallAdmissionReceipts.set(key, receipt);
    }
  }

  async function flushOnce(abortSignal?: AbortSignal) {
    abortSignal?.throwIfAborted();
    if (disabled) {
      return {
        outcome: "idle" as const,
        latestEventId,
        latestExternalEventSequence,
        pendingEventCount: 0,
        consecutiveFailures,
        disabled,
      };
    }

    if (pendingEvents.length === 0) {
      return {
        outcome: "idle" as const,
        latestEventId,
        latestExternalEventSequence,
        pendingEventCount: 0,
        consecutiveFailures,
        disabled,
      };
    }

    const queuedEvents = pendingEvents;
    const queuedToolCallStarts = pendingToolCallStarts;
    pendingEvents = [];
    pendingToolCallStarts = [];

    let flushed;
    try {
      flushed = await flushConversationRunEventQueue({
        authToken: input.authToken,
        apiUrl: input.apiUrl,
        conversationId: input.conversationId,
        runId: input.runId,
        canonicalRunId: input.canonicalRunId,
        latestEventId,
        latestExternalEventSequence,
        events: queuedEvents,
        toolCallStarts: queuedToolCallStarts,
        maxEventsPerBatch: input.maxEventsPerBatch,
        maxBatchPayloadBytes: input.maxBatchPayloadBytes,
        maxCursorResyncsPerFlush: input.maxCursorResyncsPerFlush ?? 3,
        consecutiveFailures,
        abortSignal,
        fetch: input.fetch,
        onAppendRequest: () => {
          appendRequestCount += 1;
        },
        onModelCallCaptureReceipts: storeModelCallCaptureReceipts,
        onToolCallAdmissionReceipts: storeToolCallAdmissionReceipts,
      });
    } catch (error) {
      if (!disposed) {
        pendingEvents = [...queuedEvents, ...pendingEvents];
        pendingToolCallStarts = [
          ...queuedToolCallStarts,
          ...shiftToolCallAdmissionStarts(pendingToolCallStarts, queuedEvents.length),
        ];
      }
      throw error;
    }

    if (disposed) {
      return {
        outcome: "idle" as const,
        latestEventId,
        latestExternalEventSequence,
        pendingEventCount: 0,
        consecutiveFailures,
        disabled: true,
      };
    }

    latestEventId = flushed.latestEventId;
    latestExternalEventSequence = flushed.latestExternalEventSequence;

    if (flushed.outcome === "flushed") {
      consecutiveFailures = 0;
      return {
        outcome: "flushed" as const,
        latestEventId,
        latestExternalEventSequence,
        pendingEventCount: pendingEvents.length,
        consecutiveFailures,
        disabled,
      };
    }

    if (flushed.outcome === "stopped") {
      pendingEvents = [];
      pendingToolCallStarts = [];
      disabled = true;
      disableReason = flushed.disableReason;
      return {
        outcome: "stopped" as const,
        latestEventId,
        latestExternalEventSequence,
        pendingEventCount: 0 as const,
        consecutiveFailures,
        disabled: true as const,
        ...(flushed.disableReason ? { disableReason: flushed.disableReason } : {}),
      };
    }

    pendingEvents = [...flushed.pendingEvents, ...pendingEvents];
    pendingToolCallStarts = [
      ...(flushed.pendingToolCallStarts ?? []),
      ...shiftToolCallAdmissionStarts(pendingToolCallStarts, flushed.pendingEvents.length),
    ];
    consecutiveFailures = flushed.consecutiveFailures;
    return {
      outcome: "retry_scheduled" as const,
      latestEventId,
      latestExternalEventSequence,
      pendingEventCount: pendingEvents.length,
      consecutiveFailures,
      disabled: false as const,
      errorMessage: flushed.errorMessage,
      ...(flushed.retryCause ? { retryCause: flushed.retryCause } : {}),
    };
  }

  return {
    enqueue(events, options) {
      if (disposed || disabled || events.length === 0) {
        return;
      }

      pendingToolCallStarts = [
        ...pendingToolCallStarts,
        ...shiftToolCallAdmissionStarts(options?.toolCallStarts, pendingEvents.length),
      ];
      pendingEvents.push(...events);
    },
    takeModelCallCaptureReceipt(modelCallId) {
      const key = modelCallId.toLowerCase();
      const receipt = modelCallCaptureReceipts.get(key);
      if (receipt) {
        modelCallCaptureReceipts.delete(key);
      }
      return receipt;
    },
    takeToolCallAdmissionReceipt(occurrenceId) {
      const key = occurrenceId.toLowerCase();
      const receipt = toolCallAdmissionReceipts.get(key);
      if (receipt) {
        toolCallAdmissionReceipts.delete(key);
      }
      return receipt;
    },
    flush(options) {
      // Serialize overlapping flushes: a second call while one is still
      // awaiting the network would read stale cursors and burn resync budget
      // on a self-inflicted cursor mismatch. Start synchronously when idle so
      // events enqueued right after flush() still hit the in-flight merge
      // path.
      const result = flushTail === null
        ? flushOnce(options?.abortSignal)
        : flushTail.then(() => flushOnce(options?.abortSignal));
      const tail = result.catch(() => {});
      flushTail = tail;
      void tail.then(() => {
        if (flushTail === tail) {
          flushTail = null;
        }
      });
      return result;
    },
    getSnapshot() {
      return {
        latestEventId,
        latestExternalEventSequence,
        pendingEventCount: pendingEvents.length,
        consecutiveFailures,
        disabled,
        appendRequestCount,
        ...(disableReason ? { disableReason } : {}),
      };
    },
    dispose() {
      disposed = true;
      disabled = true;
      pendingEvents = [];
      pendingToolCallStarts = [];
      modelCallCaptureReceipts.clear();
      toolCallAdmissionReceipts.clear();
    },
  };
}

async function waitForConversationRunPoll(
  ms: number,
  abortSignal?: AbortSignal,
): Promise<void> {
  if (ms <= 0 || abortSignal?.aborted) {
    return;
  }

  await new Promise<void>((resolve) => {
    const timeoutId = setTimeout(() => {
      abortSignal?.removeEventListener("abort", resolveOnAbort);
      resolve();
    }, ms);

    const resolveOnAbort = () => {
      clearTimeout(timeoutId);
      abortSignal?.removeEventListener("abort", resolveOnAbort);
      resolve();
    };

    abortSignal?.addEventListener("abort", resolveOnAbort, { once: true });
  });
}

async function controlPlaneJson<T>(input: {
  authToken: string;
  url: string;
  method?: "GET" | "POST";
  body?: unknown;
  headers?: Record<string, string>;
  responseSchema: Schema<T>;
  operation: string;
  abortSignal?: AbortSignal;
  fetch?: ConversationRunApiFetch;
}): Promise<T> {
  if (input.abortSignal?.aborted) {
    throw new DOMException("This operation was aborted", "AbortError");
  }

  const timedAbort = createTimedAbortSignal(AGENT_RUN_API_TIMEOUT_MS, input.abortSignal);

  // The timed abort must stay armed while the body is read: a server that
  // stalls mid-body would otherwise hang past the timeout.
  try {
    const response = await resolveConversationRunFetch(input.fetch)(input.url, {
      method: input.method ?? "GET",
      headers: {
        Authorization: `Bearer ${input.authToken}`,
        "Content-Type": "application/json",
        ...input.headers,
      },
      ...(input.body !== undefined ? { body: JSON.stringify(input.body) } : {}),
      signal: timedAbort.signal,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw NETWORK_ERROR.create({
        detail: `${input.operation} failed (${response.status}): ${body || response.statusText}`,
      });
    }

    return input.responseSchema.parse(await response.json());
  } catch (error) {
    if (
      timedAbort.signal.aborted &&
      !timedAbort.wasAbortedByCaller()
    ) {
      throw TIMEOUT_ERROR.create({
        detail: `${input.operation} timed out after ${AGENT_RUN_API_TIMEOUT_MS}ms`,
      });
    }
    throw error;
  } finally {
    timedAbort.cleanup();
  }
}

/** @deprecated Use getCanonicalRunStatus with the canonical UUID. Legacy projection reads are removed. */
export async function getConversationRun(input: {
  authToken: string;
  apiUrl: string;
  conversationId: string;
  runId: string;
  abortSignal?: AbortSignal;
  /** Host-owned transport used by trusted capability-backed callers. */
  fetch?: ConversationRunApiFetch;
}): Promise<ConversationRunProjection> {
  void input;
  throw new Error(
    "Legacy durable projection reads were removed. Use getCanonicalRunStatus with the canonical UUID; append cursors are supplied by admission and authenticated append receipts.",
  );
}

/** Read lifecycle state without inventing durable append cursors absent from the public resource. */
export async function getCanonicalRunStatus(input: {
  authToken: string;
  apiUrl: string;
  runId: string;
  canonicalRunId?: string;
  abortSignal?: AbortSignal;
  fetch?: ConversationRunApiFetch;
}): Promise<Pick<ConversationRunProjection, "runId" | "status">> {
  const canonicalRunId = input.canonicalRunId ?? input.runId;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(canonicalRunId)) {
    throw new Error("Canonical run identity is required for status polling");
  }
  const run = await controlPlaneJson({
    authToken: input.authToken,
    url: `${input.apiUrl}/runs/${canonicalRunId}`,
    responseSchema: FinalizedCanonicalRunSchema,
    operation: "Read run lifecycle state",
    abortSignal: input.abortSignal,
    fetch: input.fetch,
  });
  if (run.id !== canonicalRunId) throw new Error("Run response identity mismatch");
  return { runId: input.runId, status: run.status === "waiting" ? "waiting_for_tool" : run.status };
}

/** Monitor conversation run status helper. */
export async function monitorConversationRunStatus(input: {
  authToken: string;
  apiUrl: string;
  conversationId: string;
  runId: string;
  canonicalRunId?: string;
  abortSignal?: AbortSignal;
  pollIntervalMs: number;
  onTerminal: (error: ConversationRunTerminalStateError) => void | Promise<void>;
  onPollError?: (error: unknown) => void | Promise<void>;
}): Promise<void> {
  while (!input.abortSignal?.aborted) {
    await waitForConversationRunPoll(input.pollIntervalMs, input.abortSignal);
    if (input.abortSignal?.aborted) {
      return;
    }

    let run: Pick<ConversationRunProjection, "runId" | "status">;
    try {
      run = await getCanonicalRunStatus({
        authToken: input.authToken,
        apiUrl: input.apiUrl,
        canonicalRunId: input.canonicalRunId,
        runId: input.runId,
        abortSignal: input.abortSignal,
      });
    } catch (error) {
      if (input.abortSignal?.aborted) {
        return;
      }

      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }

      await input.onPollError?.(error);
      continue;
    }

    if (isActiveConversationRunStatus(run.status)) {
      continue;
    }

    if (
      run.status === "completed" ||
      run.status === "failed" ||
      run.status === "cancelled"
    ) {
      await input.onTerminal(
        new ConversationRunTerminalStateError(
          run,
          run.status,
        ),
      );
    }
    return;
  }
}

/** Append conversation run events. */
export async function appendConversationRunEvents(input: {
  authToken: string;
  apiUrl: string;
  conversationId: string;
  runId: string;
  canonicalRunId?: string;
  expectedPreviousEventId?: number;
  expectedPreviousExternalEventSequence?: number;
  events: unknown[];
  toolCallStarts?: ConversationRunToolCallAdmissionStart[];
  abortSignal?: AbortSignal;
  /** Host-owned transport used by trusted capability-backed callers. */
  fetch?: ConversationRunApiFetch;
}): Promise<AppendConversationRunEventsResponse> {
  if (input.abortSignal?.aborted) {
    throw new DOMException("This operation was aborted", "AbortError");
  }

  const canonicalRunId = input.canonicalRunId ?? input.runId;
  if (!UUID_PATTERN.test(canonicalRunId)) {
    throw new DurableRunEventPersistenceError(
      "Canonical run identity is required for event append",
    );
  }

  const submittedToolCallAdmissionStarts = readSubmittedToolCallAdmissionStarts({
    events: input.events,
    toolCallStarts: input.toolCallStarts,
  });
  const normalizedEvents = normalizeAppendEvents({
    events: input.events,
    hasToolCallAdmissionStarts: submittedToolCallAdmissionStarts.length > 0,
  });
  for (const start of submittedToolCallAdmissionStarts) {
    const normalizedEvent = normalizedEvents[start.eventIndex];
    if (
      !isToolCallStartEvent(normalizedEvent) ||
      normalizedEvent.toolCallId !== start.toolCallId
    ) {
      throw new DurableRunEventPersistenceError(
        "Tool call admission sidecar event_index changed during normalization",
      );
    }
  }
  const submittedModelCallCaptureIds = readSubmittedModelCallCaptureIds(normalizedEvents);
  requireUniqueSubmittedModelCallCaptureIds(submittedModelCallCaptureIds);
  const requiresDurableCursor = normalizedEvents.some(isPrivateConversationRunEvent);
  const isPurePrivateEventBatch = normalizedEvents.length > 0 &&
    normalizedEvents.every(isPrivateConversationRunEvent);
  if (requiresDurableCursor && input.expectedPreviousEventId === undefined) {
    throw new DurableRunEventPersistenceError(
      "Private run event append requires expected_previous_event_id",
    );
  }
  // The API omits the external cursor from pure-private receipts, so the
  // caller's known cursor is the only way to return a total result. Fail
  // before sending rather than reporting a committed append as failed.
  if (isPurePrivateEventBatch && input.expectedPreviousExternalEventSequence === undefined) {
    throw new DurableRunEventPersistenceError(
      "Private run event append requires the caller's external event sequence",
    );
  }

  const timedAbort = createTimedAbortSignal(AGENT_RUN_API_TIMEOUT_MS, input.abortSignal);

  // The timed abort must stay armed while the body is read: a server that
  // stalls mid-body would otherwise hang past the timeout.
  try {
    const requestBody = JSON.stringify({
      ...(input.expectedPreviousEventId !== undefined
        ? { expected_previous_event_id: input.expectedPreviousEventId }
        : {}),
      ...(!requiresDurableCursor && input.expectedPreviousExternalEventSequence !== undefined
        ? {
          expected_previous_external_event_sequence: input.expectedPreviousExternalEventSequence,
        }
        : {}),
      ...(submittedToolCallAdmissionStarts.length > 0
        ? { tool_call_starts: toWireToolCallAdmissionStarts(submittedToolCallAdmissionStarts) }
        : {}),
      events: normalizedEvents,
    });
    if (
      new TextEncoder().encode(requestBody).byteLength >
        MAX_CONVERSATION_RUN_EVENT_APPEND_REQUEST_BYTES
    ) {
      throw new DurableRunEventPersistenceError(
        "Run event append request exceeds the supported payload size",
      );
    }
    const response = await resolveConversationRunFetch(input.fetch)(
      `${input.apiUrl}/runs/${canonicalRunId}/events`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${input.authToken}`,
          "Content-Type": "application/json",
        },
        body: requestBody,
        signal: timedAbort.signal,
      },
    );

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      const parsedError = parseAppendConversationRunEventsError(body);
      throw new AppendConversationRunEventsError({
        status: response.status,
        cursor: readAppendCursorHeaders(response.headers),
        detail: parsedError.detail,
        slug: parsedError.slug,
        statusText: response.statusText,
      });
    }

    let responseBody = await response.json();
    if (typeof responseBody === "object" && responseBody !== null && "run_id" in responseBody) {
      if (
        typeof responseBody.run_id !== "string" ||
        IntrinsicReflectApply(StringPrototypeToLowerCase, responseBody.run_id, []) !==
          IntrinsicReflectApply(StringPrototypeToLowerCase, canonicalRunId, [])
      ) {
        throw new DurableRunEventPersistenceError(
          "Append receipt identifies a different canonical run",
        );
      }
      const hasRawModelCallCaptures = Object.hasOwn(responseBody, "model_call_captures");
      const rawModelCallCaptures = responseBody.model_call_captures;
      const hasRawToolCallAdmissions = Object.hasOwn(responseBody, "tool_call_admissions");
      const rawToolCallAdmissions = responseBody.tool_call_admissions;
      responseBody = {
        latestEventId: responseBody.latest_event_id,
        latestExternalEventSequence: responseBody.latest_external_event_sequence ??
          input.expectedPreviousExternalEventSequence,
        appendedCount: responseBody.appended_count,
        ...(hasRawModelCallCaptures
          ? {
            modelCallCaptures: Array.isArray(rawModelCallCaptures)
              ? rawModelCallCaptures.map((receipt) => {
                if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) {
                  return receipt;
                }
                const rawReceipt = receipt as Record<string, unknown>;
                return {
                  eventId: rawReceipt.event_id,
                  projectId: rawReceipt.project_id,
                  runId: rawReceipt.run_id,
                  modelCallId: rawReceipt.model_call_id,
                };
              })
              : rawModelCallCaptures,
          }
          : {}),
        ...(hasRawToolCallAdmissions
          ? {
            toolCallAdmissions: Array.isArray(rawToolCallAdmissions)
              ? rawToolCallAdmissions.map((receipt) =>
                getToolCallAdmissionWireReceiptSchema().parse(receipt)
              )
              : rawToolCallAdmissions,
          }
          : {}),
        run: {
          runId: input.runId,
          conversationId: input.conversationId,
          latestEventId: responseBody.latest_event_id,
          latestExternalEventSequence: responseBody.latest_external_event_sequence ??
            input.expectedPreviousExternalEventSequence,
        },
      };
    }
    // Pure private-event appends do not advance the external cursor and the API
    // intentionally omits it. Preserve the caller's known cursor so the shared
    // queue result remains total; mixed batches return the advanced API value.
    if (isPurePrivateEventBatch && input.expectedPreviousExternalEventSequence !== undefined) {
      responseBody = backfillPurePrivateEventResponseCursor(
        responseBody,
        input.expectedPreviousExternalEventSequence,
      );
    }
    const parsed = AppendConversationRunEventsResponseSchema.parse(responseBody);
    validateAppendModelCallCaptureReceipts({
      response: parsed,
      submittedModelCallIds: submittedModelCallCaptureIds,
      canonicalRunId,
    });
    validateAppendToolCallAdmissionReceipts({
      response: parsed,
      submittedStarts: submittedToolCallAdmissionStarts,
      canonicalRunId,
    });
    return parsed;
  } catch (error) {
    if (
      timedAbort.signal.aborted &&
      !timedAbort.wasAbortedByCaller()
    ) {
      throw TIMEOUT_ERROR.create({
        detail: `Append conversation run events timed out after ${AGENT_RUN_API_TIMEOUT_MS}ms`,
      });
    }
    throw error;
  } finally {
    timedAbort.cleanup();
  }
}

/** @deprecated Use canonical POST /runs admission and its API-issued runtime descriptor. */
export async function createConversationAgentRun(
  input: CreateConversationAgentRunInput,
): Promise<ConversationRunProjection> {
  void input;
  throw new Error(
    "Standalone durable self-admission was removed. Create a canonical run through POST /runs and execute only the API-issued durable_root_run descriptor; local inherited children require the bound admission capability.",
  );
}

/** Require the private exact-run finalizer instead of falling back to a credential-free request. */
export function requireBoundConversationAgentRunFinalizer(
  finalize: BoundConversationAgentRunFinalizer | undefined,
): BoundConversationAgentRunFinalizer {
  if (!finalize) throw new Error("Current run terminal authority is required");
  return finalize;
}

/** Finalize conversation agent run helper. */
export async function finalizeConversationAgentRun(
  input: FinalizeConversationAgentRunInput,
): Promise<void> {
  const route = terminalRoute(input.terminalAuthToken, input.runId);
  const cancelled = input.status === "cancelled";
  await controlPlaneJson({
    authToken: input.authToken,
    url: `${input.apiUrl}/runs/${route.id}/${cancelled ? "cancel" : "finalize"}`,
    method: "POST",
    headers: {
      "X-Veryfront-Run-Terminal-Token": input.terminalAuthToken,
      "Idempotency-Key": `runtime-terminal:${await computeHash(
        `${route.id}:${route.generation}:${input.status}`,
      )}`,
    },
    body: cancelled
      ? undefined
      : input.status === "completed"
      ? { status: "completed", output: input.output ?? null }
      : {
        status: "failed",
        error: {
          code: input.terminalErrorCode ?? "RUNTIME_FAILED",
          message: input.terminalErrorMessage ?? "Runtime execution failed",
        },
      },
    responseSchema: FinalizedCanonicalRunSchema,
    operation: "Finalize canonical durable run",
    fetch: input.fetch,
  });
}
