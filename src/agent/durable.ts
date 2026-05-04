import { z } from "zod";

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

export const ConversationRunTargetsSchema = z.object({
  sourceTargetKind: z.enum(["project", "preview_branch"]).nullable(),
  runtimeTargetKind: z.enum(["production", "preview_branch"]).nullable(),
  targetBranchId: z.string().uuid().nullable(),
});

export type ConversationRunTargets = z.infer<typeof ConversationRunTargetsSchema>;

export function resolveConversationRunTargets(input: {
  projectId?: string | null;
  branchId?: string | null;
}): ConversationRunTargets {
  return ConversationRunTargetsSchema.parse(
    !input.projectId
      ? {
        sourceTargetKind: null,
        runtimeTargetKind: null,
        targetBranchId: null,
      }
      : input.branchId
      ? {
        sourceTargetKind: "preview_branch",
        runtimeTargetKind: "preview_branch",
        targetBranchId: input.branchId,
      }
      : {
        sourceTargetKind: "project",
        runtimeTargetKind: "production",
        targetBranchId: null,
      },
  );
}

export const ConversationRunStatusSchema = z.enum([
  "pending",
  "running",
  "waiting_for_tool",
  "completed",
  "failed",
  "cancelled",
]);

export const ConversationRunProjectionSchema = z
  .object({
    runId: z.string().min(1).optional(),
    run_id: z.string().min(1).optional(),
    conversationId: z.string().uuid().optional(),
    conversation_id: z.string().uuid().optional(),
    messageId: z.string().uuid().optional(),
    message_id: z.string().uuid().optional(),
    latestEventId: z.number().int().nonnegative().optional(),
    latest_event_id: z.number().int().nonnegative().optional(),
    latestExternalEventSequence: z.number().int().nonnegative().optional(),
    latest_external_event_sequence: z.number().int().nonnegative().optional(),
    waitingToolCallId: z.string().min(1).nullable().optional(),
    waiting_tool_call_id: z.string().min(1).nullable().optional(),
    waitingToolName: z.string().nullable().optional(),
    waiting_tool_name: z.string().nullable().optional(),
    status: ConversationRunStatusSchema,
  })
  .passthrough()
  .transform((data) => {
    const runId = data.runId ?? data.run_id;
    const conversationId = data.conversationId ?? data.conversation_id;
    const messageId = data.messageId ?? data.message_id;
    const latestEventId = data.latestEventId ?? data.latest_event_id ?? 0;
    const latestExternalEventSequence = data.latestExternalEventSequence ??
      data.latest_external_event_sequence;

    if (!runId || !conversationId || !messageId) {
      throw new Error("Missing run identifiers in durable run response");
    }

    if (latestExternalEventSequence === undefined) {
      throw new Error("Missing latestExternalEventSequence in durable run response");
    }

    return {
      runId,
      conversationId,
      messageId,
      latestEventId,
      latestExternalEventSequence,
      waitingToolCallId: data.waitingToolCallId ?? data.waiting_tool_call_id ?? null,
      waitingToolName: data.waitingToolName ?? data.waiting_tool_name ?? null,
      status: data.status,
    };
  });

export type ConversationRunProjection = z.infer<typeof ConversationRunProjectionSchema>;
export type ActiveConversationRunStatus = Extract<
  ConversationRunProjection["status"],
  "pending" | "running" | "waiting_for_tool"
>;
export type TerminalConversationRunStatus = Extract<
  ConversationRunProjection["status"],
  "completed" | "failed" | "cancelled"
>;
export type ConversationRunAppendCursorResyncResult =
  | "advanced"
  | "non_appendable"
  | "unchanged";
export type ConversationRunAppendRecoveryOutcome =
  | "resumed"
  | "stopped"
  | "bubbled";
export type ConversationRunAppendFailureOutcome =
  | "resumed"
  | "stopped"
  | "retry_scheduled";
export type ConversationRunAppendExecutionOutcome =
  | "resumed"
  | "stopped"
  | "retry_scheduled";
export type ConversationRunBatchFlushOutcome =
  | "flushed"
  | "resumed"
  | "stopped"
  | "retry_scheduled";
export type ConversationRunQueueFlushOutcome =
  | "flushed"
  | "stopped"
  | "retry_scheduled";

export interface ConversationRunEventQueueController {
  enqueue(events: unknown[]): void;
  flush(): Promise<
    | {
      outcome: "idle" | "flushed";
      latestEventId: number;
      latestExternalEventSequence: number;
      pendingEventCount: number;
      consecutiveFailures: number;
      disabled: boolean;
    }
    | {
      outcome: "stopped";
      latestEventId: number;
      latestExternalEventSequence: number;
      pendingEventCount: 0;
      consecutiveFailures: number;
      disabled: true;
      disableReason?: "cursor_resyncs_exhausted" | "non_appendable" | "ignorable_append_rejection";
    }
    | {
      outcome: "retry_scheduled";
      latestEventId: number;
      latestExternalEventSequence: number;
      pendingEventCount: number;
      consecutiveFailures: number;
      disabled: false;
      errorMessage: string;
    }
  >;
  getSnapshot(): {
    latestEventId: number;
    latestExternalEventSequence: number;
    pendingEventCount: number;
    consecutiveFailures: number;
    disabled: boolean;
  };
}

export const CreateConversationRunAcceptedSchema = z
  .object({
    run: z
      .object({
        runId: z.string().min(1).optional(),
        run_id: z.string().min(1).optional(),
      })
      .passthrough(),
  })
  .passthrough()
  .transform((data) => {
    const runId = data.run.runId ?? data.run.run_id;
    if (!runId) {
      throw new Error("Missing run id in canonical create run response");
    }

    return { runId };
  });

export const CompleteConversationRunResponseSchema = z
  .object({
    completed: z.boolean(),
    run: z
      .object({
        runId: z.string().min(1).optional(),
        run_id: z.string().min(1).optional(),
        status: z.enum(["pending", "running", "waiting", "completed", "failed", "cancelled"]),
      })
      .passthrough(),
  })
  .passthrough();

const AppendConversationRunEventsCamelRunSchema = z
  .object({
    runId: z.string().min(1),
    conversationId: z.string().uuid(),
    latestEventId: z.number().int().nonnegative(),
    latestExternalEventSequence: z.number().int().nonnegative(),
  })
  .passthrough();

const AppendConversationRunEventsSnakeRunSchema = z
  .object({
    run_id: z.string().min(1),
    conversation_id: z.string().uuid(),
    latest_event_id: z.number().int().nonnegative(),
    latest_external_event_sequence: z.number().int().nonnegative(),
  })
  .passthrough();

export const AppendConversationRunEventsResponseSchema = z.union([
  z.object({
    latestEventId: z.number().int().nonnegative(),
    latestExternalEventSequence: z.number().int().nonnegative(),
    appendedCount: z.number().int().nonnegative(),
    run: AppendConversationRunEventsCamelRunSchema,
  }),
  z.object({
    latest_event_id: z.number().int().nonnegative(),
    latest_external_event_sequence: z.number().int().nonnegative(),
    appended_count: z.number().int().nonnegative(),
    run: AppendConversationRunEventsSnakeRunSchema,
  }).transform((data) => ({
    latestEventId: data.latest_event_id,
    latestExternalEventSequence: data.latest_external_event_sequence,
    appendedCount: data.appended_count,
    run: {
      ...data.run,
      runId: data.run.run_id,
      conversationId: data.run.conversation_id,
      latestEventId: data.run.latest_event_id,
      latestExternalEventSequence: data.run.latest_external_event_sequence,
    },
  })),
]);

export type AppendConversationRunEventsResponse = z.infer<
  typeof AppendConversationRunEventsResponseSchema
>;

const DEFAULT_MAX_CONVERSATION_RUN_BATCH_BYTES = 512 * 1024;

const ConversationRunErrorSchema = z.object({
  detail: z.string().min(1).optional(),
  error: z.string().min(1).optional(),
});

export interface ConversationAgentRunUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface CreateConversationAgentRunInput {
  authToken: string;
  apiUrl: string;
  conversationId: string;
  runId?: string;
  agentId: string;
  implementationKind?: string | null;
  projectId?: string | null;
  branchId?: string | null;
}

export interface FinalizeConversationAgentRunInput {
  authToken: string;
  apiUrl: string;
  conversationId: string;
  runId: string;
  status: "completed" | "failed" | "cancelled";
  model: string;
  provider: string;
  usage?: ConversationAgentRunUsage;
  terminalErrorCode?: string | null;
  terminalErrorMessage?: string | null;
}

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

export class AppendConversationRunEventsError extends Error {
  readonly status: number;
  readonly detail: string | null;

  constructor(input: {
    status: number;
    detail?: string | null;
    statusText?: string;
  }) {
    const detail = input.detail?.trim() || input.statusText || `HTTP ${input.status}`;
    super(`Append conversation run events failed (${input.status}): ${detail}`);
    this.name = "AppendConversationRunEventsError";
    this.status = input.status;
    this.detail = input.detail?.trim() || null;
  }
}

export function parseAppendConversationRunEventsErrorBody(bodyText: string): string | null {
  if (!bodyText) {
    return null;
  }

  try {
    const parsed = ConversationRunErrorSchema.safeParse(JSON.parse(bodyText));
    if (parsed.success) {
      return parsed.data.detail ?? parsed.data.error ?? null;
    }
  } catch {
    return bodyText;
  }

  return bodyText;
}

export function isIgnorableConversationRunAppendError(
  error: unknown,
): error is AppendConversationRunEventsError {
  if (!(error instanceof AppendConversationRunEventsError)) {
    return false;
  }

  if (error.status === 404) {
    return true;
  }

  if (error.status !== 400) {
    return false;
  }

  return (
    error.detail === "Cannot append external events to a terminal run" ||
    error.detail === "Cannot append external events while the run is waiting for a tool result"
  );
}

export function isCursorMismatchConversationRunAppendError(
  error: unknown,
): error is AppendConversationRunEventsError {
  return (
    error instanceof AppendConversationRunEventsError &&
    error.status === 400 &&
    error.detail === "External run event cursor mismatch"
  );
}

export function isActiveConversationRunStatus(
  status: ConversationRunProjection["status"],
): status is ActiveConversationRunStatus {
  return status === "pending" || status === "running" || status === "waiting_for_tool";
}

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
  disableReason?: "cursor_resyncs_exhausted" | "non_appendable" | "ignorable_append_rejection";
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

  return {
    outcome: "retry_scheduled",
    latestEventId: cursorRecovery.latestEventId,
    latestExternalEventSequence: cursorRecovery.latestExternalEventSequence,
    errorMessage: input.error instanceof Error ? input.error.message : String(input.error),
    ...(cursorRecovery.run ? { run: cursorRecovery.run } : {}),
  };
}

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
    disableReason?: "cursor_resyncs_exhausted" | "non_appendable" | "ignorable_append_rejection";
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
    disableReason?: "cursor_resyncs_exhausted" | "non_appendable" | "ignorable_append_rejection";
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
    disableReason?: "cursor_resyncs_exhausted" | "non_appendable" | "ignorable_append_rejection";
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

  return {
    enqueue(events) {
      if (disabled || events.length === 0) {
        return;
      }

      pendingEvents.push(...events);
    },
    async flush() {
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
  responseSchema: z.ZodSchema<T>;
  operation: string;
  abortSignal?: AbortSignal;
}): Promise<T> {
  if (input.abortSignal?.aborted) {
    throw new DOMException("This operation was aborted", "AbortError");
  }

  const timedAbort = createTimedAbortSignal(AGENT_RUN_API_TIMEOUT_MS, input.abortSignal);

  let response: Response;
  try {
    response = await fetch(input.url, {
      method: input.method ?? "GET",
      headers: {
        Authorization: `Bearer ${input.authToken}`,
        "Content-Type": "application/json",
      },
      ...(input.body !== undefined ? { body: JSON.stringify(input.body) } : {}),
      signal: timedAbort.signal,
    });
  } catch (error) {
    if (
      error instanceof DOMException &&
      error.name === "AbortError" &&
      !timedAbort.wasAbortedByCaller()
    ) {
      throw new Error(`${input.operation} timed out after ${AGENT_RUN_API_TIMEOUT_MS}ms`);
    }
    throw error;
  } finally {
    timedAbort.cleanup();
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `${input.operation} failed (${response.status}): ${body || response.statusText}`,
    );
  }

  return input.responseSchema.parse(await response.json());
}

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
      await input.onTerminal(new ConversationRunTerminalStateError(run, run.status));
    }
    return;
  }
}

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

  let response: Response;
  try {
    response = await fetch(
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
          events: input.events,
        }),
        signal: timedAbort.signal,
      },
    );
  } catch (error) {
    if (
      error instanceof DOMException &&
      error.name === "AbortError" &&
      !timedAbort.wasAbortedByCaller()
    ) {
      throw new Error(
        `Append conversation run events timed out after ${AGENT_RUN_API_TIMEOUT_MS}ms`,
      );
    }
    throw error;
  } finally {
    timedAbort.cleanup();
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new AppendConversationRunEventsError({
      status: response.status,
      detail: parseAppendConversationRunEventsErrorBody(body),
      statusText: response.statusText,
    });
  }

  return AppendConversationRunEventsResponseSchema.parse(await response.json());
}

export async function createConversationAgentRun(
  input: CreateConversationAgentRunInput,
): Promise<ConversationRunProjection> {
  const targets = resolveConversationRunTargets({
    projectId: input.projectId ?? null,
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
    }
    : {
      mode: "default_chat" as const,
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
      request,
    },
    responseSchema: CreateConversationRunAcceptedSchema,
    operation: "Create canonical durable run",
  });

  return getConversationRun({
    authToken: input.authToken,
    apiUrl: input.apiUrl,
    conversationId: input.conversationId,
    runId,
  });
}

export async function finalizeConversationAgentRun(
  input: FinalizeConversationAgentRunInput,
): Promise<void> {
  const metadata = input.status === "completed"
    ? {
      provider: input.provider,
      model: input.model,
      inputTokens: input.usage?.inputTokens ?? 0,
      outputTokens: input.usage?.outputTokens ?? 0,
      finishReason: "stop",
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
