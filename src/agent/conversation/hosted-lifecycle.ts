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

export interface ConversationHostedLifecycleFinalizeInput {
  model: string;
  provider: string;
  usage?: ConversationAgentRunUsage;
  terminalErrorCode?: string | null;
  terminalErrorMessage?: string | null;
}

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

export function createConversationHostedLifecycleAdapter<TChunk>(
  options: CreateConversationHostedLifecycleAdapterOptions<TChunk>,
): HostedLifecycleAdapter<ConversationRunProjection, TChunk> {
  return {
    startRun: options.startRun,
    appendEvents: options.mapChunkToEvents
      ? async (run, chunk) => {
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
  await publishInvokeAgentChildRunProgress(
    {
      authToken: ctx.authToken,
      apiUrl: ctx.apiUrl,
      conversationId: ctx.parentConversationId,
      runId: ctx.parentRunId,
      ...(ctx.projectId !== undefined ? { projectId: ctx.projectId } : {}),
      ...ctx.progress,
      status,
      ...(ctx.publishParentRunEvents ? { publishParentRunEvents: ctx.publishParentRunEvents } : {}),
    } as Parameters<typeof publishInvokeAgentChildRunProgress>[0],
  );
}

export function createConversationChildLifecycleAdapter(
  ctx: ConversationChildLifecycleContext,
): HostedChildLifecycleAdapter {
  return {
    pending: () => publishConversationChildProgress(ctx, "pending"),
    running: () => publishConversationChildProgress(ctx, "running"),
    completed: async (terminalState) => {
      await finalizeConversationAgentRun({
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
      });
      await publishConversationChildProgress(ctx, "completed");
    },
    failed: async (terminalState) => {
      await finalizeConversationAgentRun({
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
      });
      await publishConversationChildProgress(ctx, "failed");
    },
    cancelled: async (terminalState) => {
      await finalizeConversationAgentRun({
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
      });
      await publishConversationChildProgress(ctx, "cancelled");
    },
  };
}
