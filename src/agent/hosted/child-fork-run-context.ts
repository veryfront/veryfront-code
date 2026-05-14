import type { ChatMessageMetadata, ChatUiMessageChunk } from "#veryfront/chat/protocol.ts";
import {
  createHostedChildMirrorContext,
  type HostedChildChunkMirror,
  type HostedChildMirrorContext,
} from "./child-mirror.ts";
import {
  type ConversationRunChunkMirror,
  createHostedConversationRunChunkMirror,
  type HostedConversationRunChunkMirrorInstrumentation,
} from "../conversation/run-chunk-mirror.ts";
import {
  createHostedChildPendingToolLifecycle,
  createHostedChildPendingToolLifecycleLogger,
  type HostedChildPendingToolLifecycleLogContext,
  type HostedChildPendingToolLifecycleLogWriter,
} from "./child-pending-tool-lifecycle.ts";
import {
  executeHostedChildForkStream,
  type ExecuteHostedChildForkStreamInput,
  handleHostedChildForkFailure,
  type HandleHostedChildForkFailureInput,
  type HostedChildForkPendingToolLifecycle,
} from "./child-fork-stream-execution.ts";
import {
  closeChildRunExecutionBuffers,
  finalizeChildRunExecutionResources,
} from "../child-run/execution-cleanup.ts";
import type {
  ChildRunExecutionResult,
  ChildRunExecutionSnapshot,
} from "../child-run/execution-snapshot.ts";
import { isChildRunAbortError } from "../child-run/execution-support.ts";
import { type HostedChildRunIdentifiers, HostedChildTerminalStateError } from "./child-status.ts";

export interface HostedChildForkToolCallSnapshot {
  toolName: string;
  toolCallId: string;
  input?: unknown;
}

export interface HostedChildForkToolResultSnapshot {
  toolName: string;
  toolCallId: string;
  input: unknown;
  output: unknown;
}

export interface HostedChildForkStreamState {
  finalText: string;
}

export interface HostedChildForkStreamMirrorContext {
  durableRunMirror: boolean;
  durableMessageId: string | null;
  durableReasoningMessageId: string | null;
  durableMirrorState: HostedChildMirrorContext["state"];
  appendDurableMirrorChunk: (chunk: ChatUiMessageChunk<ChatMessageMetadata>) => Promise<void>;
  closeDurableMirrorReasoning: () => Promise<void>;
  closeDurableMirrorText: () => Promise<void>;
  markDurableStepStarted: () => void;
  hasStartedStep: () => boolean;
  hasEmittedProgress: () => boolean;
}

export interface HostedChildForkRunContext {
  mirrorContext: HostedChildMirrorContext;
  streamMirrorContext: HostedChildForkStreamMirrorContext;
  pendingToolLifecycle: HostedChildForkPendingToolLifecycle;
  toolCalls: HostedChildForkToolCallSnapshot[];
  toolResults: HostedChildForkToolResultSnapshot[];
  streamState: HostedChildForkStreamState;
}

export type HostedDurableChildForkRunContext = HostedChildForkRunContext & {
  durableRunMirror: ConversationRunChunkMirror | null;
};

export interface HostedChildForkRunContextInput {
  mirror: HostedChildChunkMirror | null;
  messageId?: string | null;
  reasoningMessageId?: string | null;
  pendingToolLogContext: HostedChildPendingToolLifecycleLogContext;
  pendingToolLogWriter?: HostedChildPendingToolLifecycleLogWriter;
}

export interface HostedDurableChildForkRunContextInput {
  authToken: string;
  apiUrl: string;
  durableChildRun?: HostedChildRunIdentifiers;
  instrumentation?: HostedConversationRunChunkMirrorInstrumentation;
  pendingToolLogContext: HostedChildPendingToolLifecycleLogContext;
  pendingToolLogWriter?: HostedChildPendingToolLifecycleLogWriter;
}

export interface HandleHostedChildForkRunContextErrorInput {
  error: unknown;
  abortSignal?: AbortSignal;
  description: string;
  kind: string;
  runContext: HostedChildForkRunContext;
  usage?: ChildRunExecutionSnapshot["usage"];
  startTime: number;
  onSettled?: (snapshot: ChildRunExecutionSnapshot) => void | Promise<void>;
  shouldRethrowError?: (error: unknown) => boolean;
  writeLog?: HandleHostedChildForkFailureInput["writeLog"];
}

export interface FinalizeHostedChildForkRunContextResourcesInput {
  runContext: HostedChildForkRunContext;
  monitorAbortController?: AbortController | null;
  monitorPromise?: Promise<void>;
  flushMirror?: () => Promise<void>;
  closeTooling?: () => Promise<void>;
  closeRuntime?: () => Promise<void>;
}

export function createHostedChildForkRunContext(
  input: HostedChildForkRunContextInput,
): HostedChildForkRunContext {
  const mirrorContext = createHostedChildMirrorContext({
    mirror: input.mirror,
    messageId: input.messageId,
    reasoningMessageId: input.reasoningMessageId,
  });
  const streamMirrorContext: HostedChildForkStreamMirrorContext = {
    durableRunMirror: Boolean(mirrorContext.mirror),
    durableMessageId: mirrorContext.messageId,
    durableReasoningMessageId: mirrorContext.reasoningMessageId,
    durableMirrorState: mirrorContext.state,
    appendDurableMirrorChunk: mirrorContext.appendChunk,
    closeDurableMirrorReasoning: mirrorContext.closeReasoningSegment,
    closeDurableMirrorText: mirrorContext.closeTextSegment,
    markDurableStepStarted: mirrorContext.markStepStarted,
    hasStartedStep: mirrorContext.hasStartedStep,
    hasEmittedProgress: mirrorContext.hasEmittedProgress,
  };

  return {
    mirrorContext,
    streamMirrorContext,
    pendingToolLifecycle: createHostedChildPendingToolLifecycle({
      appendMirrorChunk: streamMirrorContext.appendDurableMirrorChunk,
      logger: input.pendingToolLogWriter
        ? createHostedChildPendingToolLifecycleLogger(
          input.pendingToolLogContext,
          input.pendingToolLogWriter,
        )
        : undefined,
    }),
    toolCalls: [],
    toolResults: [],
    streamState: { finalText: "" },
  };
}

export function createHostedDurableChildForkRunContext(
  input: HostedDurableChildForkRunContextInput,
): HostedDurableChildForkRunContext {
  const durableRunMirror = input.durableChildRun
    ? createHostedConversationRunChunkMirror({
      authToken: input.authToken,
      apiUrl: input.apiUrl,
      conversationId: input.durableChildRun.childConversationId,
      runId: input.durableChildRun.childRunId,
      latestEventId: input.durableChildRun.latestEventId,
      latestExternalEventSequence: input.durableChildRun.latestExternalEventSequence,
      instrumentation: input.instrumentation,
    })
    : null;

  return {
    durableRunMirror,
    ...createHostedChildForkRunContext({
      mirror: durableRunMirror,
      messageId: input.durableChildRun?.childMessageId ?? null,
      pendingToolLogContext: input.pendingToolLogContext,
      pendingToolLogWriter: input.pendingToolLogWriter,
    }),
  };
}

export type ExecuteHostedChildForkRunContextStreamInput =
  & Pick<
    ExecuteHostedChildForkStreamInput,
    | "streamResult"
    | "abortSignal"
    | "abortForkStream"
    | "conversationId"
    | "parentRunId"
    | "description"
    | "kind"
    | "usage"
    | "maxSteps"
    | "startTime"
    | "finalizationTimeoutMs"
    | "onSettled"
    | "idleTimeoutMs"
    | "activeToolTimeoutMs"
    | "postToolIdleTimeoutMs"
    | "logger"
    | "writeLog"
    | "tracePart"
  >
  & {
    runContext: HostedChildForkRunContext;
  };

export function executeHostedChildForkRunContextStream(
  input: ExecuteHostedChildForkRunContextStreamInput,
) {
  const { streamMirrorContext, pendingToolLifecycle, toolCalls, toolResults, streamState } =
    input.runContext;

  return executeHostedChildForkStream({
    streamResult: input.streamResult,
    abortSignal: input.abortSignal,
    abortForkStream: input.abortForkStream,
    conversationId: input.conversationId,
    parentRunId: input.parentRunId,
    description: input.description,
    kind: input.kind,
    durableRunMirror: streamMirrorContext.durableRunMirror,
    durableMessageId: streamMirrorContext.durableMessageId,
    durableReasoningMessageId: streamMirrorContext.durableReasoningMessageId,
    durableMirrorState: streamMirrorContext.durableMirrorState,
    appendDurableMirrorChunk: streamMirrorContext.appendDurableMirrorChunk,
    closeDurableMirrorReasoning: streamMirrorContext.closeDurableMirrorReasoning,
    closeDurableMirrorText: streamMirrorContext.closeDurableMirrorText,
    markDurableStepStarted: streamMirrorContext.markDurableStepStarted,
    durableMirrorHasEmittedProgress: streamMirrorContext.hasEmittedProgress,
    pendingToolLifecycle,
    toolCalls,
    toolResults,
    streamState,
    usage: input.usage,
    maxSteps: input.maxSteps,
    startTime: input.startTime,
    finalizationTimeoutMs: input.finalizationTimeoutMs,
    onSettled: input.onSettled,
    idleTimeoutMs: input.idleTimeoutMs,
    activeToolTimeoutMs: input.activeToolTimeoutMs,
    postToolIdleTimeoutMs: input.postToolIdleTimeoutMs,
    logger: input.logger,
    writeLog: input.writeLog,
    tracePart: input.tracePart,
  });
}

export async function handleHostedChildForkRunContextError(
  input: HandleHostedChildForkRunContextErrorInput,
): Promise<ChildRunExecutionResult> {
  const { streamMirrorContext, pendingToolLifecycle, toolCalls, toolResults, streamState } =
    input.runContext;

  await closeChildRunExecutionBuffers({
    closeReasoningBuffer: streamMirrorContext.closeDurableMirrorReasoning,
    closeTextBuffer: streamMirrorContext.closeDurableMirrorText,
  });
  await pendingToolLifecycle.closePendingToolCalls(
    isChildRunAbortError(input.error) || input.abortSignal?.aborted
      ? { kind: "aborted" }
      : { kind: "error", error: input.error },
  );
  if (input.abortSignal?.aborted || isChildRunAbortError(input.error)) {
    throw input.error;
  }

  if (input.error instanceof HostedChildTerminalStateError) {
    throw input.error;
  }

  return handleHostedChildForkFailure({
    error: input.error,
    description: input.description,
    kind: input.kind,
    finalText: streamState.finalText,
    toolCalls,
    toolResults,
    usage: input.usage,
    startTime: input.startTime,
    onSettled: input.onSettled,
    shouldRethrowError: input.shouldRethrowError,
    writeLog: input.writeLog,
  });
}

export async function finalizeHostedChildForkRunContextResources(
  input: FinalizeHostedChildForkRunContextResourcesInput,
): Promise<void> {
  const { streamMirrorContext } = input.runContext;

  await finalizeChildRunExecutionResources({
    closeReasoningBuffer: streamMirrorContext.closeDurableMirrorReasoning,
    closeTextBuffer: streamMirrorContext.closeDurableMirrorText,
    durableStepStarted: streamMirrorContext.hasStartedStep(),
    flushMirror: async () => {
      input.monitorAbortController?.abort();
      await input.monitorPromise;
      await input.flushMirror?.();
    },
    appendFinishStepChunk: () =>
      streamMirrorContext.appendDurableMirrorChunk({
        type: "finish-step",
      }),
    closeTooling: input.closeTooling,
    closeRuntime: input.closeRuntime,
  });
}
