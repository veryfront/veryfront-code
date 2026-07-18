import type { Schema } from "#veryfront/extensions/schema/index.ts";
import { NETWORK_ERROR, TIMEOUT_ERROR } from "#veryfront/errors";
import {
  AppendConversationRunEventsResponseSchema,
  CompleteConversationRunResponseSchema,
  ConversationRunProjectionSchema,
  CreateConversationRunAcceptedSchema,
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
  parseAppendConversationRunEventsErrorBody,
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

function createTimedAbortSignal(timeoutMs: number, abortSignal?: AbortSignal) {
  const controller = new AbortController();
  let abortedByCaller = false;
  const timeout = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  const onAbort = () => {
    abortedByCaller = true;
    controller.abort();
  };

  if (abortSignal?.aborted) {
    onAbort();
  } else {
    abortSignal?.addEventListener("abort", onAbort, { once: true });
  }

  return {
    signal: controller.signal,
    wasAbortedByCaller: () => abortedByCaller,
    cleanup: () => {
      clearTimeout(timeout);
      abortSignal?.removeEventListener("abort", onAbort);
    },
  };
}

const DEFAULT_MAX_CONVERSATION_RUN_BATCH_BYTES = 512 * 1024;

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

/** Resync conversation run append cursor helper. */
export async function resyncConversationRunAppendCursor(input: {
  authToken: string;
  apiUrl: string;
  conversationId: string;
  runId: string;
  previousLatestExternalEventSequence: number;
  abortSignal?: AbortSignal;
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
  abortSignal?: AbortSignal;
}): Promise<{
  outcome: ConversationRunAppendRecoveryOutcome;
  latestEventId: number;
  latestExternalEventSequence: number;
  disableReason?: "cursor_resyncs_exhausted" | "non_appendable";
  run?: ConversationRunProjection;
}> {
  if (!isCursorMismatchConversationRunAppendError(input.error)) {
    return {
      outcome: "bubbled",
      latestEventId: input.latestEventId,
      latestExternalEventSequence: input.latestExternalEventSequence,
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
      disableReason: "non_appendable",
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
  abortSignal?: AbortSignal;
}): Promise<{
  outcome: ConversationRunAppendFailureOutcome;
  latestEventId: number;
  latestExternalEventSequence: number;
  disableReason?:
    | "cursor_resyncs_exhausted"
    | "non_appendable"
    | "ignorable_append_rejection"
    | "payload_too_large"
    | "auth_rejected";
  errorMessage?: string;
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
    abortSignal: input.abortSignal,
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
  abortSignal?: AbortSignal;
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
      | "non_appendable"
      | "ignorable_append_rejection"
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
    abortSignal: input.abortSignal,
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
  }
  | {
    outcome: "stopped";
    latestEventId: number;
    latestExternalEventSequence: number;
    disableReason?:
      | "cursor_resyncs_exhausted"
      | "non_appendable"
      | "ignorable_append_rejection"
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
    const batch = batches[batchIndex];
    if (!batch) {
      continue;
    }
    try {
      const response = await appendConversationRunEvents({
        authToken: input.authToken,
        apiUrl: input.apiUrl,
        conversationId: input.conversationId,
        runId: input.runId,
        expectedPreviousExternalEventSequence: latestExternalEventSequence,
        events: batch,
        abortSignal: input.abortSignal,
      });
      latestEventId = response.latestEventId;
      latestExternalEventSequence = response.latestExternalEventSequence;
    } catch (error) {
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
        abortSignal: input.abortSignal,
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
          ? { errorMessage: recovered.errorMessage }
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
      | "non_appendable"
      | "ignorable_append_rejection"
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
}): ConversationRunEventQueueController {
  let latestEventId = input.latestEventId;
  let latestExternalEventSequence = input.latestExternalEventSequence;
  let pendingEvents: unknown[] = [];
  let consecutiveFailures = 0;
  let disabled = false;
  let flushTail: Promise<unknown> | null = null;

  async function flushOnce() {
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
      });
    } catch (error) {
      pendingEvents = [...queuedEvents, ...pendingEvents];
      throw error;
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
    };
  }

  return {
    enqueue(events) {
      if (disabled || events.length === 0) {
        return;
      }

      pendingEvents.push(...events);
    },
    flush() {
      // Serialize overlapping flushes: a second call while one is still
      // awaiting the network would read stale cursors and burn resync budget
      // on a self-inflicted cursor mismatch. Start synchronously when idle so
      // events enqueued right after flush() still hit the in-flight merge
      // path.
      const result = flushTail === null ? flushOnce() : flushTail.then(flushOnce);
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
      };
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
}): Promise<T> {
  if (input.abortSignal?.aborted) {
    throw new DOMException("This operation was aborted", "AbortError");
  }

  const timedAbort = createTimedAbortSignal(AGENT_RUN_API_TIMEOUT_MS, input.abortSignal);

  // The timed abort must stay armed while the body is read: a server that
  // stalls mid-body would otherwise hang past the timeout.
  try {
    const response = await fetch(input.url, {
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
      error instanceof DOMException &&
      error.name === "AbortError" &&
      !timedAbort.wasAbortedByCaller()
    ) {
      throw TIMEOUT_ERROR.create({ detail: `${input.operation} timed out after ${AGENT_RUN_API_TIMEOUT_MS}ms` });
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
}): Promise<ConversationRunProjection> {
  return controlPlaneJson({
    authToken: input.authToken,
    url: `${input.apiUrl}/conversations/${input.conversationId}/runs/${input.runId}`,
    responseSchema: ConversationRunProjectionSchema,
    operation: "Read conversation durable run projection",
    abortSignal: input.abortSignal,
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
}): Promise<AppendConversationRunEventsResponse> {
  if (input.abortSignal?.aborted) {
    throw new DOMException("This operation was aborted", "AbortError");
  }

  const timedAbort = createTimedAbortSignal(AGENT_RUN_API_TIMEOUT_MS, input.abortSignal);

  // The timed abort must stay armed while the body is read: a server that
  // stalls mid-body would otherwise hang past the timeout.
  try {
    const response = await fetch(
      `${input.apiUrl}/conversations/${input.conversationId}/runs/${input.runId}/events`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${input.authToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...(input.expectedPreviousEventId !== undefined
            ? { expected_previous_event_id: input.expectedPreviousEventId }
            : {}),
          ...(input.expectedPreviousExternalEventSequence !== undefined
            ? {
              expected_previous_external_event_sequence:
                input.expectedPreviousExternalEventSequence,
            }
            : {}),
          // Chokepoint guard: every append path funnels through here, so enforce the
          // per-event size limit here too. Upstream mirrors already normalize, but
          // direct callers (hosted lifecycle, child-run progress) do not — this makes
          // it impossible to POST an event the API would reject for size. Idempotent
          // on already-normalized events.
          events: normalizeConversationRunEvents(
            input.events as Parameters<typeof normalizeConversationRunEvents>[0],
          ),
        }),
        signal: timedAbort.signal,
      },
    );

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new AppendConversationRunEventsError({
        status: response.status,
        detail: parseAppendConversationRunEventsErrorBody(body),
        statusText: response.statusText,
      });
    }

    return AppendConversationRunEventsResponseSchema.parse(await response.json());
  } catch (error) {
    if (
      error instanceof DOMException &&
      error.name === "AbortError" &&
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
  const runId = input.runId ?? `run_${crypto.randomUUID()}`;

  const request = input.implementationKind
    ? {
      mode: "agent" as const,
      agent_id: input.agentId,
      implementation_kind: input.implementationKind,
      initial_status: "pending" as const,
      ...(targets.sourceTargetKind ? { source_target_kind: targets.sourceTargetKind } : {}),
      ...(targets.runtimeTargetKind ? { runtime_target_kind: targets.runtimeTargetKind } : {}),
      ...(targets.targetBranchId
        ? {
          source_target_branch_id: targets.targetBranchId,
          runtime_target_branch_id: targets.targetBranchId,
        }
        : {}),
      ...(targets.targetEnvironmentId
        ? {
          source_target_environment_id: targets.targetEnvironmentId,
          runtime_target_environment_id: targets.targetEnvironmentId,
        }
        : {}),
    }
    : {
      mode: "agent" as const,
      agent_id: input.agentId,
      initial_status: "running" as const,
      ...(targets.sourceTargetKind ? { source_target_kind: targets.sourceTargetKind } : {}),
      ...(targets.runtimeTargetKind ? { runtime_target_kind: targets.runtimeTargetKind } : {}),
      ...(targets.targetBranchId
        ? {
          source_target_branch_id: targets.targetBranchId,
          runtime_target_branch_id: targets.targetBranchId,
        }
        : {}),
      ...(targets.targetEnvironmentId
        ? {
          source_target_environment_id: targets.targetEnvironmentId,
          runtime_target_environment_id: targets.targetEnvironmentId,
        }
        : {}),
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
