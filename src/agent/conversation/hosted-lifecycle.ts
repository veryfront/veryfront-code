import {
  appendConversationRunEvents,
  type ConversationAgentRunUsage,
  type ConversationRunProjection,
  finalizeConversationAgentRun,
} from "./durable.ts";
import { prepareConversationRunStreamEvents } from "./run-event-preparation.ts";
import {
  type InvokeAgentChildRunProgressEvent,
  type InvokeAgentChildRunProgressInput,
  publishInvokeAgentChildRunProgress,
} from "../child-run/invoke-agent-child-runs.ts";
import type { ChatStreamEvent } from "#veryfront/chat/protocol.ts";
import type {
  HostedChildLifecycleAdapter,
  HostedChildLifecycleTerminalState,
} from "../hosted/child-lifecycle.ts";
import type { HostedLifecycleAdapter, HostedLifecycleTerminalState } from "../hosted/lifecycle.ts";
import { agentLogger } from "#veryfront/utils/logger/logger.ts";

/** Input payload for conversation hosted lifecycle finalize. */
export interface ConversationHostedLifecycleFinalizeInput {
  model: string;
  provider: string;
  usage?: ConversationAgentRunUsage;
  terminalErrorCode?: string | null;
  terminalErrorMessage?: string | null;
}

/** Options accepted by create conversation hosted lifecycle adapter. */
export interface CreateConversationHostedLifecycleAdapterOptions<TChunk> {
  authToken: string;
  apiUrl: string;
  startRun: (
    input: { abortSignal: AbortSignal },
  ) => Promise<ConversationRunProjection> | ConversationRunProjection;
  mapChunkToEvents?: (
    chunk: TChunk,
    run: ConversationRunProjection,
  ) => Promise<readonly unknown[] | unknown[]> | readonly unknown[] | unknown[];
  resolveFinalizeInput: (input: {
    run: ConversationRunProjection;
    terminalState: HostedLifecycleTerminalState;
  }) =>
    | Promise<ConversationHostedLifecycleFinalizeInput>
    | ConversationHostedLifecycleFinalizeInput;
}

/** Create conversation hosted lifecycle adapter. */
export function createConversationHostedLifecycleAdapter<TChunk>(
  options: CreateConversationHostedLifecycleAdapterOptions<TChunk>,
): HostedLifecycleAdapter<ConversationRunProjection, TChunk> {
  // Appends read run.latestEventId as the expected cursor and write it back,
  // so overlapping calls would race the read-modify-write and trip the
  // server-side cursor check. Chain them so each append sees the previous
  // cursor update.
  let appendChain: Promise<void> = Promise.resolve();

  const appendChunkEvents = async (
    run: ConversationRunProjection,
    chunk: TChunk,
  ): Promise<void> => {
    const events = [...await options.mapChunkToEvents!(chunk, run)];
    if (events.length === 0) {
      return;
    }

    const appended = await appendConversationRunEvents({
      authToken: options.authToken,
      apiUrl: options.apiUrl,
      conversationId: run.conversationId,
      runId: run.runId,
      expectedPreviousEventId: run.latestEventId,
      expectedPreviousExternalEventSequence: run.latestExternalEventSequence,
      events,
    });

    run.latestEventId = appended.latestEventId;
    run.latestExternalEventSequence = appended.latestExternalEventSequence;
  };

  return {
    startRun: options.startRun,
    appendEvents: options.mapChunkToEvents
      ? (run, chunk) => {
        const result = appendChain.then(() => appendChunkEvents(run, chunk));
        // The chain must not turn an append failure into an unhandled
        // rejection, but a silently swallowed failure would let the run keep
        // appending against a broken durable store. The caller still awaits
        // `result` (and sees the rejection); here we only keep the chain alive
        // and surface the failure so it is observable.
        appendChain = result.catch((error) => {
          agentLogger.error("Durable conversation run append failed", {
            conversationId: run.conversationId,
            runId: run.runId,
            error,
          });
        });
        return result;
      }
      : undefined,
    finalizeRun: async (run, terminalState) => {
      const finalizeInput = await options.resolveFinalizeInput({ run, terminalState });
      await finalizeConversationAgentRun({
        authToken: options.authToken,
        apiUrl: options.apiUrl,
        conversationId: run.conversationId,
        runId: run.runId,
        status: terminalState.status,
        model: finalizeInput.model,
        provider: finalizeInput.provider,
        usage: finalizeInput.usage,
        terminalErrorCode: finalizeInput.terminalErrorCode,
        terminalErrorMessage: finalizeInput.terminalErrorMessage,
      });
    },
    cancelRun: async (run, terminalState) => {
      const finalizeInput = await options.resolveFinalizeInput({ run, terminalState });
      await finalizeConversationAgentRun({
        authToken: options.authToken,
        apiUrl: options.apiUrl,
        conversationId: run.conversationId,
        runId: run.runId,
        status: "cancelled",
        model: finalizeInput.model,
        provider: finalizeInput.provider,
        usage: finalizeInput.usage,
        terminalErrorCode: finalizeInput.terminalErrorCode,
        terminalErrorMessage: finalizeInput.terminalErrorMessage,
      });
    },
  };
}

/** Create conversation hosted stream lifecycle adapter. */
export function createConversationHostedStreamLifecycleAdapter(
  options: Omit<
    CreateConversationHostedLifecycleAdapterOptions<ChatStreamEvent>,
    "mapChunkToEvents"
  >,
): HostedLifecycleAdapter<ConversationRunProjection, ChatStreamEvent> {
  return createConversationHostedLifecycleAdapter({
    ...options,
    mapChunkToEvents: (chunk) => prepareConversationRunStreamEvents([chunk]),
  });
}

/** Context for conversation child lifecycle. */
export interface ConversationChildLifecycleContext {
  authToken: string;
  apiUrl: string;
  parentConversationId: string;
  parentRunId: string;
  projectId?: string | null;
  publishParentRunEvents?: (events: InvokeAgentChildRunProgressEvent[]) => Promise<void> | void;
  progress: Omit<InvokeAgentChildRunProgressInput, "status">;
  model: string;
  provider: string;
}

function toConversationChildUsage(
  usage: HostedChildLifecycleTerminalState["usage"],
): ConversationAgentRunUsage | undefined {
  if (!usage) {
    return undefined;
  }

  const inputTokens = usage.inputTokens ?? 0;
  const outputTokens = usage.outputTokens ?? 0;
  return {
    inputTokens,
    outputTokens,
    totalTokens: usage.totalTokens ?? inputTokens + outputTokens,
  };
}

async function publishConversationChildProgress(
  ctx: ConversationChildLifecycleContext,
  status: InvokeAgentChildRunProgressInput["status"],
): Promise<void> {
  await publishInvokeAgentChildRunProgress({
    authToken: ctx.authToken,
    apiUrl: ctx.apiUrl,
    conversationId: ctx.parentConversationId,
    runId: ctx.parentRunId,
    ...ctx.progress,
    status,
    ...(ctx.publishParentRunEvents ? { publishParentRunEvents: ctx.publishParentRunEvents } : {}),
  });
}

async function finalizeChildRunThenPublish(
  ctx: ConversationChildLifecycleContext,
  status: "completed" | "failed" | "cancelled",
  finalize: () => Promise<void>,
): Promise<void> {
  let failed = false;
  let finalizeError: unknown;
  try {
    await finalize();
  } catch (error) {
    failed = true;
    finalizeError = error;
  }

  // The parent must learn the terminal status even when finalization fails;
  // otherwise its projection shows the child as running forever.
  await publishConversationChildProgress(ctx, status);

  if (failed) {
    throw finalizeError;
  }
}

/** Create conversation child lifecycle adapter. */
export function createConversationChildLifecycleAdapter(
  ctx: ConversationChildLifecycleContext,
): HostedChildLifecycleAdapter {
  return {
    pending: () => publishConversationChildProgress(ctx, "pending"),
    running: () => publishConversationChildProgress(ctx, "running"),
    completed: (terminalState) =>
      finalizeChildRunThenPublish(ctx, "completed", () =>
        finalizeConversationAgentRun({
          authToken: ctx.authToken,
          apiUrl: ctx.apiUrl,
          conversationId: ctx.progress.childConversationId,
          runId: ctx.progress.childRunId,
          status: "completed",
          model: ctx.model,
          provider: ctx.provider,
          usage: toConversationChildUsage(terminalState.usage),
          terminalErrorCode: null,
          terminalErrorMessage: null,
        })),
    failed: (terminalState) =>
      finalizeChildRunThenPublish(ctx, "failed", () =>
        finalizeConversationAgentRun({
          authToken: ctx.authToken,
          apiUrl: ctx.apiUrl,
          conversationId: ctx.progress.childConversationId,
          runId: ctx.progress.childRunId,
          status: "failed",
          model: ctx.model,
          provider: ctx.provider,
          usage: toConversationChildUsage(terminalState.usage),
          terminalErrorCode: terminalState.terminalErrorCode ?? "FAILED",
          terminalErrorMessage: terminalState.terminalErrorMessage ?? "Unknown error",
        })),
    cancelled: (terminalState) =>
      finalizeChildRunThenPublish(ctx, "cancelled", () =>
        finalizeConversationAgentRun({
          authToken: ctx.authToken,
          apiUrl: ctx.apiUrl,
          conversationId: ctx.progress.childConversationId,
          runId: ctx.progress.childRunId,
          status: "cancelled",
          model: ctx.model,
          provider: ctx.provider,
          usage: toConversationChildUsage(terminalState.usage),
          terminalErrorCode: terminalState.terminalErrorCode ?? "CANCELLED",
          terminalErrorMessage: terminalState.terminalErrorMessage ?? "Child run cancelled",
        })),
  };
}
