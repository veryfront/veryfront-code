import type { Schema } from "#veryfront/extensions/schema/index.ts";
import { isVeryfrontError, NETWORK_ERROR, TIMEOUT_ERROR } from "#veryfront/errors";
import {
  AppendConversationRunEventsResponseSchema,
  CompleteConversationRunResponseSchema,
  ConversationRunProjectionSchema,
  CreateConversationRunAcceptedSchema,
  createConversationRunTargetRequestFields,
  resolveConversationRunTargets,
} from "./durable-contracts.ts";
import type {
  ActiveConversationRunStatus,
  AppendConversationRunEventsResponse,
  ConversationRunAppendCursorResyncResult,
  ConversationRunAppendFailureOutcome,
  ConversationRunAppendRecoveryOutcome,
  ConversationRunEventQueueController,
  ConversationRunProjection,
  CreateConversationAgentRunInput,
  FinalizeConversationAgentRunInput,
  TerminalConversationRunStatus,
} from "./durable-contracts.ts";
import {
  AppendConversationRunEventsError,
  isCursorMismatchConversationRunAppendError,
  isIgnorableConversationRunAppendError,
  isPayloadTooLargeConversationRunAppendError,
  isPermanentAuthConversationRunAppendError,
  isTerminalRunConversationRunAppendError,
  parseAppendConversationRunEventsError,
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
import { normalizeConversationRunEvents } from "./run-event-normalization.ts";
import { MAX_CONVERSATION_RUN_EVENT_APPEND_REQUEST_BYTES } from "./run-event-limits.ts";
import {
  DurableRunEventPersistenceError,
  isPrivateConversationRunEvent,
} from "./private-run-event.ts";
export type {
  ActiveConversationRunStatus,
  AppendConversationRunEventsResponse,
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
  CreateConversationAgentRunInput,
  FinalizeConversationAgentRunInput,
  TerminalConversationRunStatus,
} from "./durable-contracts.ts";

const AGENT_RUN_API_TIMEOUT_MS = 15_000;
type ConversationRunApiFetch = typeof globalThis.fetch;

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

/** Error shape for conversation run terminal state. */
export class ConversationRunTerminalStateError extends Error {
  readonly status: TerminalConversationRunStatus;
  readonly run: ConversationRunProjection;

  constructor(run: ConversationRunProjection, status: TerminalConversationRunStatus) {
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

/** Resync conversation run append cursor helper. */
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

  const resynced = await resyncConversationRunAppendCursor({
    authToken: input.authToken,
    apiUrl: input.apiUrl,
    conversationId: input.conversationId,
    runId: input.runId,
    previousLatestExternalEventSequence: input.latestExternalEventSequence,
    abortSignal: input.abortSignal,
    fetch: input.fetch,
  });

  if (resynced.result === "advanced") {
    return {
      outcome: "resumed",
      latestEventId: resynced.run.latestEventId,
      latestExternalEventSequence: resynced.run.latestExternalEventSequence,
      run: resynced.run,
    };
  }

  if (resynced.result === "non_appendable") {
    return {
      outcome: "stopped",
      latestEventId: resynced.run.latestEventId,
      latestExternalEventSequence: resynced.run.latestExternalEventSequence,
      // A cursor mismatch can resolve to a run that is already finished. That is
      // the same clean stop as the terminal-run append rejection and must not be
      // lumped in with `waiting_for_tool`, which is non-appendable but still alive
      // and still has to be completed (veryfront-issue-inbox#743).
      disableReason: isTerminalConversationRunProjection(resynced.run)
        ? "run_terminal"
        : "non_appendable",
      run: resynced.run,
    };
  }

  return {
    outcome: "bubbled",
    latestEventId: resynced.run.latestEventId,
    latestExternalEventSequence: resynced.run.latestExternalEventSequence,
    run: resynced.run,
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

  if (recovered.outcome === "resumed") {
    return {
      outcome: "resumed",
      latestEventId: recovered.latestEventId,
      latestExternalEventSequence: recovered.latestExternalEventSequence,
      pendingEvents: [...input.remainingEvents, ...input.pendingEvents],
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
  latestEventId: number;
  latestExternalEventSequence: number;
  events: unknown[];
  pendingEvents?: unknown[];
  maxEventsPerBatch: number;
  maxBatchPayloadBytes?: number;
  cursorResyncsThisFlush?: number;
  consecutiveFailures?: number;
  maxCursorResyncsPerFlush: number;
  abortSignal?: AbortSignal;
  onAppendRequest?: () => void;
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

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
    input.abortSignal?.throwIfAborted();
    const batch = batches[batchIndex];
    if (!batch) {
      continue;
    }
    const cursorMode = batch.some(isPrivateConversationRunEvent)
      ? "durable_event_id" as const
      : "external_sequence" as const;
    try {
      input.onAppendRequest?.();
      const response = await appendConversationRunEvents({
        authToken: input.authToken,
        apiUrl: input.apiUrl,
        conversationId: input.conversationId,
        runId: input.runId,
        ...(cursorMode === "durable_event_id" ? { expectedPreviousEventId: latestEventId } : {}),
        expectedPreviousExternalEventSequence: latestExternalEventSequence,
        events: batch,
        abortSignal: input.abortSignal,
        fetch: input.fetch,
      });
      latestEventId = response.latestEventId;
      latestExternalEventSequence = response.latestExternalEventSequence;
    } catch (error) {
      input.abortSignal?.throwIfAborted();
      const recovered = await recoverConversationRunAppendExecution({
        error,
        authToken: input.authToken,
        apiUrl: input.apiUrl,
        conversationId: input.conversationId,
        runId: input.runId,
        latestEventId,
        latestExternalEventSequence,
        remainingEvents: batches.slice(batchIndex).flat(),
        pendingEvents: input.pendingEvents ?? [],
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
  latestEventId: number;
  latestExternalEventSequence: number;
  events: unknown[];
  maxEventsPerBatch: number;
  maxBatchPayloadBytes?: number;
  maxCursorResyncsPerFlush: number;
  consecutiveFailures?: number;
  abortSignal?: AbortSignal;
  onAppendRequest?: () => void;
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
    consecutiveFailures: number;
    errorMessage: string;
    retryCause?: "timeout";
  }
> {
  let latestEventId = input.latestEventId;
  let latestExternalEventSequence = input.latestExternalEventSequence;
  let pendingEvents = [...input.events];
  let cursorResyncsThisFlush = 0;
  let consecutiveFailures = input.consecutiveFailures ?? 0;

  while (pendingEvents.length > 0) {
    const events = pendingEvents;
    pendingEvents = [];

    const flushed = await flushConversationRunEventBatches({
      authToken: input.authToken,
      apiUrl: input.apiUrl,
      conversationId: input.conversationId,
      runId: input.runId,
      latestEventId,
      latestExternalEventSequence,
      events,
      pendingEvents,
      maxEventsPerBatch: input.maxEventsPerBatch,
      maxBatchPayloadBytes: input.maxBatchPayloadBytes,
      cursorResyncsThisFlush,
      consecutiveFailures,
      maxCursorResyncsPerFlush: input.maxCursorResyncsPerFlush,
      abortSignal: input.abortSignal,
      onAppendRequest: input.onAppendRequest,
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
  let consecutiveFailures = 0;
  let disabled = false;
  let disposed = false;
  let appendRequestCount = 0;
  let disableReason: ReturnType<
    ConversationRunEventQueueController["getSnapshot"]
  >["disableReason"];
  let flushTail: Promise<unknown> | null = null;

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
    pendingEvents = [];

    let flushed;
    try {
      flushed = await flushConversationRunEventQueue({
        authToken: input.authToken,
        apiUrl: input.apiUrl,
        conversationId: input.conversationId,
        runId: input.runId,
        latestEventId,
        latestExternalEventSequence,
        events: queuedEvents,
        maxEventsPerBatch: input.maxEventsPerBatch,
        maxBatchPayloadBytes: input.maxBatchPayloadBytes,
        maxCursorResyncsPerFlush: input.maxCursorResyncsPerFlush ?? 3,
        consecutiveFailures,
        abortSignal,
        fetch: input.fetch,
        onAppendRequest: () => {
          appendRequestCount += 1;
        },
      });
    } catch (error) {
      if (!disposed) {
        pendingEvents = [...queuedEvents, ...pendingEvents];
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
    enqueue(events) {
      if (disposed || disabled || events.length === 0) {
        return;
      }

      pendingEvents.push(...events);
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
      tail.then(() => {
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
    const response = await (input.fetch ?? globalThis.fetch)(input.url, {
      method: input.method ?? "GET",
      headers: {
        Authorization: `Bearer ${input.authToken}`,
        "Content-Type": "application/json",
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

/** Return conversation run. */
export async function getConversationRun(input: {
  authToken: string;
  apiUrl: string;
  conversationId: string;
  runId: string;
  abortSignal?: AbortSignal;
  /** Host-owned transport used by trusted capability-backed callers. */
  fetch?: ConversationRunApiFetch;
}): Promise<ConversationRunProjection> {
  return controlPlaneJson({
    authToken: input.authToken,
    url: `${input.apiUrl}/conversations/${input.conversationId}/runs/${input.runId}`,
    responseSchema: ConversationRunProjectionSchema,
    operation: "Read conversation durable run projection",
    abortSignal: input.abortSignal,
    fetch: input.fetch,
  });
}

/** Monitor conversation run status helper. */
export async function monitorConversationRunStatus(input: {
  authToken: string;
  apiUrl: string;
  conversationId: string;
  runId: string;
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

    let run: ConversationRunProjection;
    try {
      run = await getConversationRun({
        authToken: input.authToken,
        apiUrl: input.apiUrl,
        conversationId: input.conversationId,
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
  expectedPreviousEventId?: number;
  expectedPreviousExternalEventSequence?: number;
  events: unknown[];
  abortSignal?: AbortSignal;
  /** Host-owned transport used by trusted capability-backed callers. */
  fetch?: ConversationRunApiFetch;
}): Promise<AppendConversationRunEventsResponse> {
  if (input.abortSignal?.aborted) {
    throw new DOMException("This operation was aborted", "AbortError");
  }

  const normalizedEvents = normalizeConversationRunEvents(
    input.events as Parameters<typeof normalizeConversationRunEvents>[0],
  );
  const requiresDurableCursor = normalizedEvents.some(isPrivateConversationRunEvent);
  const isPurePrivateEventBatch = normalizedEvents.length > 0 &&
    normalizedEvents.every(isPrivateConversationRunEvent);
  if (requiresDurableCursor && input.expectedPreviousEventId === undefined) {
    throw new DurableRunEventPersistenceError(
      "Private run event append requires expected_previous_event_id",
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
    const response = await (input.fetch ?? globalThis.fetch)(
      `${input.apiUrl}/conversations/${input.conversationId}/runs/${input.runId}/events`,
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
        detail: parsedError.detail,
        slug: parsedError.slug,
        statusText: response.statusText,
      });
    }

    let responseBody = await response.json();
    // Pure private-event appends do not advance the external cursor and the API
    // intentionally omits it. Preserve the caller's known cursor so the shared
    // queue result remains total; mixed batches return the advanced API value.
    if (isPurePrivateEventBatch && input.expectedPreviousExternalEventSequence !== undefined) {
      responseBody = backfillPurePrivateEventResponseCursor(
        responseBody,
        input.expectedPreviousExternalEventSequence,
      );
    }
    return AppendConversationRunEventsResponseSchema.parse(responseBody);
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

/** Create conversation agent run. */
export async function createConversationAgentRun(
  input: CreateConversationAgentRunInput,
): Promise<ConversationRunProjection> {
  const targets = resolveConversationRunTargets({
    projectId: input.projectId ?? null,
    runtimeTargetKind: input.runtimeTargetKind ?? null,
    environmentId: input.runtimeTargetEnvironmentId ?? null,
    branchId: input.branchId ?? null,
  });
  const targetRequestFields = createConversationRunTargetRequestFields(targets);
  const runId = input.runId ?? `run_${crypto.randomUUID()}`;

  const request = input.implementationKind
    ? {
      mode: "agent" as const,
      agent_id: input.agentId,
      implementation_kind: input.implementationKind,
      initial_status: "pending" as const,
      ...targetRequestFields,
    }
    : {
      mode: "agent" as const,
      agent_id: input.agentId,
      initial_status: "running" as const,
      ...targetRequestFields,
    };

  await controlPlaneJson({
    authToken: input.authToken,
    url: `${input.apiUrl}/runs`,
    method: "POST",
    body: {
      kind: "agent",
      owner: {
        kind: "conversation",
        id: input.conversationId,
      },
      public_id: runId,
      ...(input.parentRunId ? { parent_run_id: input.parentRunId } : {}),
      request,
    },
    responseSchema: CreateConversationRunAcceptedSchema,
    operation: "Create canonical durable run",
    abortSignal: input.abortSignal,
  });

  return getConversationRun({
    authToken: input.authToken,
    apiUrl: input.apiUrl,
    conversationId: input.conversationId,
    runId,
    abortSignal: input.abortSignal,
  });
}

/** Finalize conversation agent run helper. */
export async function finalizeConversationAgentRun(
  input: FinalizeConversationAgentRunInput,
): Promise<void> {
  const metadata = input.status === "completed"
    ? {
      provider: input.provider,
      model: input.model,
      inputTokens: input.usage?.inputTokens ?? 0,
      outputTokens: input.usage?.outputTokens ?? 0,
      ...(input.usage?.usageCaptureStatus !== undefined
        ? { usageCaptureStatus: input.usage.usageCaptureStatus }
        : {}),
      finishReason: input.finishReason ?? "stop",
    }
    : null;

  await controlPlaneJson({
    authToken: input.authToken,
    url: `${input.apiUrl}/runs/${input.runId}/complete`,
    method: "POST",
    body: {
      status: input.status,
      metadata,
      terminal_error_code: input.terminalErrorCode ?? null,
      terminal_error_message: input.terminalErrorMessage ?? null,
    },
    responseSchema: CompleteConversationRunResponseSchema,
    operation: "Complete canonical durable run",
  });
}
