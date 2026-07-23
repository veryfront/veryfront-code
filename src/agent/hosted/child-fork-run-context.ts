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

/** Public API contract for hosted child fork tool call snapshot. */
export interface HostedChildForkToolCallSnapshot {
  /** Tool name value. */
  toolName: string;
  /** Tool call ID value. */
  toolCallId: string;
  /** Input supplied to the operation. */
  input?: unknown;
}

/** Public API contract for hosted child fork tool result snapshot. */
export interface HostedChildForkToolResultSnapshot {
  /** Tool name value. */
  toolName: string;
  /** Tool call ID value. */
  toolCallId: string;
  /** Input supplied to the operation. */
  input: unknown;
  /** Output produced by the operation. */
  output: unknown;
}

/** State for hosted child fork stream. */
export interface HostedChildForkStreamState {
  /** Final text value. */
  finalText: string;
}

/** Context for hosted child fork stream mirror. */
export interface HostedChildForkStreamMirrorContext {
  /** Whether durable run mirror. */
  durableRunMirror: boolean;
  /** Durable message ID value. */
  durableMessageId: string | null;
  /** Durable reasoning message ID value. */
  durableReasoningMessageId: string | null;
  /** Durable mirror state value. */
  durableMirrorState: HostedChildMirrorContext["state"];
  /** Callback that handles append durable mirror chunk. */
  appendDurableMirrorChunk: (chunk: ChatUiMessageChunk<ChatMessageMetadata>) => Promise<void>;
  /** Callback that handles close durable mirror reasoning. */
  closeDurableMirrorReasoning: () => Promise<void>;
  /** Callback that handles close durable mirror text. */
  closeDurableMirrorText: () => Promise<void>;
  /** Callback that handles mark durable step started. */
  markDurableStepStarted: () => void;
  /** Callback that handles has started step. */
  hasStartedStep: () => boolean;
  /** Callback that handles has emitted progress. */
  hasEmittedProgress: () => boolean;
}

/** Context for hosted child fork run. */
export interface HostedChildForkRunContext {
  /** Mirror context value. */
  mirrorContext: HostedChildMirrorContext;
  /** Stream mirror context value. */
  streamMirrorContext: HostedChildForkStreamMirrorContext;
  /** Pending tool lifecycle value. */
  pendingToolLifecycle: HostedChildForkPendingToolLifecycle;
  /** Tool calls value. */
  toolCalls: HostedChildForkToolCallSnapshot[];
  /** Tool results value. */
  toolResults: HostedChildForkToolResultSnapshot[];
  /** Stream state value. */
  streamState: HostedChildForkStreamState;
}

/** Context for hosted durable child fork run. */
export type HostedDurableChildForkRunContext = HostedChildForkRunContext & {
  durableRunMirror: ConversationRunChunkMirror | null;
};

/** Input payload for hosted child fork run context. */
export interface HostedChildForkRunContextInput {
  /** Mirror value. */
  mirror: HostedChildChunkMirror | null;
  /** Message ID value. */
  messageId?: string | null;
  /** Reasoning message ID value. */
  reasoningMessageId?: string | null;
  /** Pending tool log context value. */
  pendingToolLogContext: HostedChildPendingToolLifecycleLogContext;
  /** Pending tool log writer value. */
  pendingToolLogWriter?: HostedChildPendingToolLifecycleLogWriter;
}

/** Input payload for hosted durable child fork run context. */
export interface HostedDurableChildForkRunContextInput {
  /** Bearer token used for authenticated API requests. */
  authToken: string;
  /** Base URL for Veryfront API requests. */
  apiUrl: string;
  /** Durable child run value. */
  durableChildRun?: HostedChildRunIdentifiers;
  /** Instrumentation value. */
  instrumentation?: HostedConversationRunChunkMirrorInstrumentation;
  /** Pending tool log context value. */
  pendingToolLogContext: HostedChildPendingToolLifecycleLogContext;
  /** Pending tool log writer value. */
  pendingToolLogWriter?: HostedChildPendingToolLifecycleLogWriter;
}

/** Input payload for handle hosted child fork run context error. */
export interface HandleHostedChildForkRunContextErrorInput {
  /** Error associated with the operation. */
  error: unknown;
  /** Abort signal value. */
  abortSignal?: AbortSignal;
  /** Description value. */
  description: string;
  /** Kind value. */
  kind: string;
  /** Run context value. */
  runContext: HostedChildForkRunContext;
  /** Usage value. */
  usage?: ChildRunExecutionSnapshot["usage"];
  /** Start time value. */
  startTime: number;
  /** Callback invoked when settled. */
  onSettled?: (snapshot: ChildRunExecutionSnapshot) => void | Promise<void>;
  /** Callback that handles should rethrow error. */
  shouldRethrowError?: (error: unknown) => boolean;
  /** Write log value. */
  writeLog?: HandleHostedChildForkFailureInput["writeLog"];
}

/** Input payload for finalize hosted child fork run context resources. */
export interface FinalizeHostedChildForkRunContextResourcesInput {
  /** Run context value. */
  runContext: HostedChildForkRunContext;
  /** Monitor abort controller value. */
  monitorAbortController?: AbortController | null;
  /** Monitor promise value. */
  monitorPromise?: Promise<void>;
  /** Callback that handles flush mirror. */
  flushMirror?: () => Promise<void>;
  /** Callback that handles close tooling. */
  closeTooling?: () => Promise<void>;
  /** Callback that handles close runtime. */
  closeRuntime?: () => Promise<void>;
}

/** Context for create hosted child fork run. */
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

/** Context for create hosted durable child fork run. */
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

/** Input payload for execute hosted child fork run context stream. */
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
    | "resultMode"
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

/** Execute hosted child fork run context stream. */
export function executeHostedChildForkRunContextStream(
  input: ExecuteHostedChildForkRunContextStreamInput,
): Promise<ChildRunExecutionResult> {
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
    resultMode: input.resultMode,
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

/** Error shape for handle hosted child fork run context. */
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

/** Finalize hosted child fork run context resources helper. */
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
