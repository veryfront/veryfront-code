import {
  buildChatStreamChunkMessageMetadata,
  extractChatMessageMetadata,
} from "../chat/chat-ui-message-helpers.ts";
import { getLastStreamStep } from "../chat/final-step-fallback.ts";
import type { ChatUiMessage, ChatUiMessageChunk, MessageMetadata } from "../chat/types.ts";
import {
  buildDetachedFallbackChunks,
  buildDetachedFallbackMessageState,
  buildFinalizedMessageFallbackChunks,
  buildFinalizedMessageState,
} from "./hosted-finalized-message.ts";
import type {
  HostedChatRuntimeAgent,
  HostedChatRuntimeStreamInput,
  HostedChatRuntimeStreamResult,
  HostedChatRuntimeToUiMessageStreamOptions,
} from "./hosted-chat-runtime-contract.ts";
import type { HostedLifecycleTerminalState } from "./hosted-lifecycle.ts";
import {
  type ConversationHostedTerminalRuntimeAdapter,
  type ConversationHostedTerminalStateInput,
  dispatchConversationHostedStreamErrorState,
  dispatchConversationHostedTerminalState,
  resolveConversationHostedTerminalState,
  toConversationHostedTerminalState,
} from "./conversation-hosted-terminal.ts";
import {
  createHostedMirroredUiStream,
  createMirroredToolChunkState,
  type MirroredToolChunkState,
} from "./mirrored-tool-chunk-state.ts";
import {
  finalizeHostedDetached,
  finalizeHostedResponse,
  type FinalizeHostedResponseOptions,
  type HostedDetachedFinalizationState,
  type HostedResponseFinalizationState,
} from "./hosted-stream-finalization.ts";
import {
  getEmptyHostedFinalizedMessageTerminalError,
  getHostedStreamErrorText,
  shouldFailEmptyHostedFinalizedMessage,
} from "./hosted-stream-terminal-error.ts";
import type { ConversationRunChunkMirror } from "./conversation-run-chunk-mirror.ts";
import type { BuildChatStreamChunkMessageMetadataInput } from "../chat/chat-ui-message-helpers.ts";
import { createChatStreamWatchdog } from "../chat/stream-watchdog.ts";

const INCOMPLETE_TOOL_CALLS_PART_ERROR_TEXT = "Assistant ended before tool execution completed";

const FINALIZATION_TERMINAL_STATE_FALLBACK_MODEL_ID = "";

export interface HostedChatExecutionRuntime {
  agentUIStream: AsyncIterable<ChatUiMessageChunk<MessageMetadata>>;
  fail: (error: unknown) => Promise<void>;
  waitForFinish: () => Promise<void>;
}

export interface HostedChatExecutionRuntimeLogger {
  error: (message: string, metadata?: Record<string, unknown>) => void;
  warn: (message: string, metadata?: Record<string, unknown>) => void;
}

export interface HostedChatExecutionRunContext {
  withContext: <T>(fn: () => T) => T;
  setMessageId?: (messageId: string) => void;
}

export interface HostedChatExecutionLifecycleAdapter
  extends ConversationHostedTerminalRuntimeAdapter {
  durableRootRun: {
    runId: string;
    messageId?: string | null;
  } | null;
  durableRunMirror: ConversationRunChunkMirror | null;
}

export type HostedChatExecutionRootStreamWatchdog = ReturnType<typeof createChatStreamWatchdog>;

export interface HostedChatExecutionRuntimeBootstrap {
  cleanup: () => Promise<void>;
  lifecycleAdapter: HostedChatExecutionLifecycleAdapter;
  rootStreamWatchdog: HostedChatExecutionRootStreamWatchdog;
  streamResult: HostedChatRuntimeStreamResult;
  streamingMessageId: string | null;
  capturedMessageId: string | null;
  capturedConversationId?: string;
  mirroredToolChunkState: MirroredToolChunkState;
}

export interface CreateHostedChatExecutionRuntimeBootstrapInput {
  agent: HostedChatRuntimeAgent;
  cleanup: () => Promise<void>;
  lifecycleAdapter: HostedChatExecutionLifecycleAdapter;
  finalMessages: HostedChatRuntimeStreamInput["messages"];
  conversationId?: string;
  abortSignal: AbortSignal;
  traceStream?: <T>(operation: () => Promise<T>) => Promise<T>;
  createRootStreamWatchdog?: () => HostedChatExecutionRootStreamWatchdog;
}

export interface CreateHostedChatExecutionRuntimeInput {
  agentId: string;
  modelId: string;
  originalMessages: ChatUiMessage[];
  responseMessageId?: string;
  runContext: HostedChatExecutionRunContext;
  abortSignal: AbortSignal;
  bootstrap: HostedChatExecutionRuntimeBootstrap;
  logger?: HostedChatExecutionRuntimeLogger;
  incompleteToolCallsPartErrorText?: string;
}

type SharedFinalizationHooks = Pick<
  FinalizeHostedResponseOptions<ChatUiMessage, ChatUiMessageChunk<MessageMetadata>>,
  | "resolveEmptyTerminalError"
  | "appendFallbackChunk"
  | "flushMirror"
  | "dispatchTerminalState"
  | "resolveTerminalState"
  | "cleanup"
  | "streamError"
>;

export function toHostedChatExecutionFinalState(
  input: ConversationHostedTerminalStateInput,
): HostedLifecycleTerminalState {
  return toConversationHostedTerminalState({
    state: input,
    fallbackModelId: FINALIZATION_TERMINAL_STATE_FALLBACK_MODEL_ID,
  });
}

export async function cleanupAfterHostedChatExecutionFinalization(input: {
  cleanup: () => Promise<void>;
  logger?: HostedChatExecutionRuntimeLogger;
}): Promise<void> {
  await input.cleanup().catch((cleanupError: unknown) => {
    input.logger?.error("Runtime cleanup failed during finalization", {
      error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
    });
  });
}

function createHostedChatExecutionCleanup(cleanup: () => Promise<void>): () => Promise<void> {
  let cleanedUp = false;

  return async () => {
    if (cleanedUp) {
      return;
    }

    cleanedUp = true;
    await cleanup();
  };
}

function createDefaultHostedChatExecutionRootStreamWatchdog(): HostedChatExecutionRootStreamWatchdog {
  return createChatStreamWatchdog({
    setTimeoutFn: globalThis.setTimeout,
    clearTimeoutFn: globalThis.clearTimeout,
  });
}

function traceHostedChatRuntimeStream<T>(
  traceStream: CreateHostedChatExecutionRuntimeBootstrapInput["traceStream"],
  operation: () => Promise<T>,
): Promise<T> {
  if (!traceStream) {
    return operation();
  }

  return traceStream(operation);
}

export async function createHostedChatExecutionRuntimeBootstrap(
  input: CreateHostedChatExecutionRuntimeBootstrapInput,
): Promise<HostedChatExecutionRuntimeBootstrap> {
  const cleanup = createHostedChatExecutionCleanup(input.cleanup);
  const streamingMessageId = input.lifecycleAdapter.durableRootRun?.messageId ?? null;
  if (input.conversationId && !streamingMessageId) {
    throw new Error("DURABLE_CHAT_ROOT_REQUIRES_CONVERSATION");
  }

  const rootStreamWatchdog = input.createRootStreamWatchdog
    ? input.createRootStreamWatchdog()
    : createDefaultHostedChatExecutionRootStreamWatchdog();
  const streamAbortSignal = AbortSignal.any([input.abortSignal, rootStreamWatchdog.signal]);

  const streamResult = await traceHostedChatRuntimeStream(
    input.traceStream,
    () =>
      input.agent.stream({
        messages: input.finalMessages,
        abortSignal: streamAbortSignal,
      }),
  );

  return {
    cleanup,
    lifecycleAdapter: input.lifecycleAdapter,
    rootStreamWatchdog,
    streamResult,
    streamingMessageId,
    capturedMessageId: streamingMessageId,
    ...(input.conversationId ? { capturedConversationId: input.conversationId } : {}),
    mirroredToolChunkState: createMirroredToolChunkState(),
  };
}

export function createHostedChatStreamFinalizationHooks(input: {
  lifecycleAdapter: HostedChatExecutionLifecycleAdapter;
  cleanup: () => Promise<void>;
  streamError: unknown;
  logger?: HostedChatExecutionRuntimeLogger;
}): SharedFinalizationHooks {
  return {
    resolveEmptyTerminalError: (
      { finalStep, streamError }: { finalStep: unknown; streamError?: unknown | null },
    ) => getEmptyHostedFinalizedMessageTerminalError({ finalStep, streamError }),
    appendFallbackChunk: (chunk: ChatUiMessageChunk<MessageMetadata>) =>
      input.lifecycleAdapter.durableRunMirror?.handleChunk(chunk),
    flushMirror: () => input.lifecycleAdapter.durableRunMirror?.flush(),
    dispatchTerminalState: async (terminalState) => {
      await dispatchConversationHostedTerminalState(input.lifecycleAdapter, terminalState);
    },
    resolveTerminalState: ({ isAborted, hasIncompleteToolParts }: {
      isAborted: boolean;
      hasIncompleteToolParts: boolean;
    }) =>
      toHostedChatExecutionFinalState(
        resolveConversationHostedTerminalState({ isAborted, hasIncompleteToolParts }),
      ),
    cleanup: () =>
      cleanupAfterHostedChatExecutionFinalization({
        cleanup: input.cleanup,
        logger: input.logger,
      }),
    streamError: input.streamError,
  };
}

export function createHostedChatFinalizeResponseBuildState(input: {
  responseMessage: ChatUiMessage;
  isAborted: boolean;
  lifecycleAdapter: HostedChatExecutionLifecycleAdapter;
  mirroredToolChunkState: MirroredToolChunkState;
  capturedMessageId: string | null;
  incompleteToolCallsPartErrorText: string;
}): (
  finalStep: unknown,
) => Promise<HostedResponseFinalizationState<ChatUiMessage, ChatUiMessageChunk<MessageMetadata>>> {
  return async (finalStep) => {
    const { persistedMessage, sanitizedFinalizedMessage, hasIncompleteFinalizedToolParts } =
      buildFinalizedMessageState({
        responseMessage: input.responseMessage,
        isAborted: input.isAborted,
        finalStep,
        incompleteToolCallsPartErrorText: input.incompleteToolCallsPartErrorText,
      });

    return {
      persistedMessage,
      finalizedMessage: sanitizedFinalizedMessage,
      fallbackChunks:
        sanitizedFinalizedMessage.parts.length > 0 && input.lifecycleAdapter.durableRunMirror
          ? buildFinalizedMessageFallbackChunks({
            persistedMessage,
            sanitizedFinalizedMessage,
            finalStep,
            mirroredToolChunkState: input.mirroredToolChunkState,
            capturedMessageId: input.capturedMessageId,
            hasIncompleteFinalizedToolParts,
          })
          : [],
      hasIncompleteToolParts: hasIncompleteFinalizedToolParts,
      metadata: extractChatMessageMetadata(sanitizedFinalizedMessage.metadata),
    };
  };
}

export function createHostedChatFinalizeDetachedBuildState(input: {
  capturedMessageId: string | null;
  isAborted: boolean;
  lifecycleAdapter: HostedChatExecutionLifecycleAdapter;
  mirroredToolChunkState: MirroredToolChunkState;
  mirroredDurableOutput: boolean;
  incompleteToolCallsPartErrorText: string;
}): (
  finalStep: unknown,
) => Promise<HostedDetachedFinalizationState<ChatUiMessageChunk<MessageMetadata>>> {
  return async (finalStep) => {
    const { finalizedFallbackMessage, hasIncompleteFallbackToolParts } =
      buildDetachedFallbackMessageState({
        capturedMessageId: input.capturedMessageId,
        finalStep,
        isAborted: input.isAborted,
        incompleteToolCallsPartErrorText: input.incompleteToolCallsPartErrorText,
      });
    const fallbackParts = finalizedFallbackMessage.parts;

    return {
      hasContent: fallbackParts.length > 0,
      fallbackChunks: fallbackParts.length > 0 && input.lifecycleAdapter.durableRunMirror &&
          input.capturedMessageId
        ? buildDetachedFallbackChunks({
          fallbackParts,
          finalStep,
          mirroredToolChunkState: input.mirroredToolChunkState,
          mirroredDurableOutput: input.mirroredDurableOutput,
          capturedMessageId: input.capturedMessageId,
          hasIncompleteFallbackToolParts,
        })
        : [],
      hasIncompleteToolParts: hasIncompleteFallbackToolParts,
    };
  };
}

async function finalizeExecutionFailure(input: {
  lifecycleAdapter: HostedChatExecutionLifecycleAdapter;
  error: unknown;
  conversationId?: string;
  runId?: string;
  logMessage: string;
  logger?: HostedChatExecutionRuntimeLogger;
}): Promise<void> {
  await dispatchConversationHostedStreamErrorState(input.lifecycleAdapter, input.error).catch(
    (finalizeError) => {
      input.logger?.error(input.logMessage, {
        conversationId: input.conversationId,
        runId: input.runId,
        error: finalizeError instanceof Error ? finalizeError.message : String(finalizeError),
      });
    },
  );
}

function createStreamMessageMetadataBuilder(input: {
  agentId: string;
  modelId: string;
  lifecycleAdapter: HostedChatExecutionLifecycleAdapter;
  streamingMessageId: string | null;
}): HostedChatRuntimeToUiMessageStreamOptions["messageMetadata"] {
  return ({ part }) =>
    buildChatStreamChunkMessageMetadata(
      {
        agentId: input.agentId,
        modelId: input.modelId,
        ...(input.lifecycleAdapter.durableRootRun
          ? { runId: input.lifecycleAdapter.durableRootRun.runId }
          : {}),
        ...(input.streamingMessageId ? { streamingMessageId: input.streamingMessageId } : {}),
        part: {
          type: part.type,
          ...("totalUsage" in part ? { totalUsage: part.totalUsage } : {}),
        },
      } satisfies BuildChatStreamChunkMessageMetadataInput,
    );
}

function logCleanupError(input: {
  error: unknown;
  logger?: HostedChatExecutionRuntimeLogger;
}): void {
  input.logger?.error("Runtime cleanup failed", {
    error: input.error instanceof Error ? input.error.message : String(input.error),
  });
}

async function finalizeResponseFinish(input: {
  responseMessage: ChatUiMessage;
  isAborted: boolean;
  streamResult: { steps: PromiseLike<readonly unknown[]> };
  lastStreamError: unknown;
  lifecycleAdapter: HostedChatExecutionLifecycleAdapter;
  mirroredToolChunkState: MirroredToolChunkState;
  capturedMessageId: string | null;
  incompleteToolCallsPartErrorText: string;
  cleanup: () => Promise<void>;
  logger?: HostedChatExecutionRuntimeLogger;
}): Promise<void> {
  const hooks = createHostedChatStreamFinalizationHooks({
    lifecycleAdapter: input.lifecycleAdapter,
    cleanup: input.cleanup,
    streamError: input.lastStreamError,
    logger: input.logger,
  });
  const buildState = createHostedChatFinalizeResponseBuildState({
    responseMessage: input.responseMessage,
    isAborted: input.isAborted,
    lifecycleAdapter: input.lifecycleAdapter,
    mirroredToolChunkState: input.mirroredToolChunkState,
    capturedMessageId: input.capturedMessageId,
    incompleteToolCallsPartErrorText: input.incompleteToolCallsPartErrorText,
  });

  await finalizeHostedResponse({
    isAborted: input.isAborted,
    getFinalStep: () => getLastStreamStep(input.streamResult),
    buildState,
    shouldFailEmptyMessage: ({ isAborted, message }) =>
      shouldFailEmptyHostedFinalizedMessage({ isAborted, message }),
    ...hooks,
  });
}

async function finalizeDetachedStreamEnd(input: {
  capturedMessageId: string | null;
  streamResult: { steps: PromiseLike<readonly unknown[]> };
  isAborted: boolean;
  lastStreamError: unknown;
  lifecycleAdapter: HostedChatExecutionLifecycleAdapter;
  mirroredToolChunkState: MirroredToolChunkState;
  mirroredDurableOutput: boolean;
  incompleteToolCallsPartErrorText: string;
  cleanup: () => Promise<void>;
  logger?: HostedChatExecutionRuntimeLogger;
}): Promise<void> {
  const hooks = createHostedChatStreamFinalizationHooks({
    lifecycleAdapter: input.lifecycleAdapter,
    cleanup: input.cleanup,
    streamError: input.lastStreamError,
    logger: input.logger,
  });
  const buildState = createHostedChatFinalizeDetachedBuildState({
    capturedMessageId: input.capturedMessageId,
    isAborted: input.isAborted,
    lifecycleAdapter: input.lifecycleAdapter,
    mirroredToolChunkState: input.mirroredToolChunkState,
    mirroredDurableOutput: input.mirroredDurableOutput,
    incompleteToolCallsPartErrorText: input.incompleteToolCallsPartErrorText,
  });

  await finalizeHostedDetached({
    isAborted: input.isAborted,
    mirroredDurableOutput: input.mirroredDurableOutput,
    getFinalStep: () => getLastStreamStep(input.streamResult),
    buildState,
    ...hooks,
  });
}

function resolveStreamingMessageId(input: {
  conversationId?: string;
  lifecycleAdapter: HostedChatExecutionLifecycleAdapter;
  runContext: HostedChatExecutionRunContext;
}): string | null {
  const streamingMessageId = input.lifecycleAdapter.durableRootRun?.messageId ?? null;
  if (input.conversationId && !streamingMessageId) {
    throw new Error("DURABLE_CHAT_ROOT_REQUIRES_CONVERSATION");
  }

  if (streamingMessageId) {
    input.runContext.setMessageId?.(streamingMessageId);
  }

  return streamingMessageId;
}

export function createHostedChatExecutionRuntime(
  input: CreateHostedChatExecutionRuntimeInput,
): HostedChatExecutionRuntime {
  let finishPromise: Promise<void> = Promise.resolve();
  let lastStreamError: unknown = null;
  let finishHandlerStarted = false;
  let mirroredDurableOutput = false;
  const incompleteToolCallsPartErrorText = input.incompleteToolCallsPartErrorText ??
    INCOMPLETE_TOOL_CALLS_PART_ERROR_TEXT;
  const streamingMessageId = resolveStreamingMessageId({
    conversationId: input.bootstrap.capturedConversationId,
    lifecycleAdapter: input.bootstrap.lifecycleAdapter,
    runContext: input.runContext,
  });

  const finalizeDetachedStreamEndIfNeeded = async () => {
    if (finishHandlerStarted) {
      return;
    }

    finishHandlerStarted = true;
    await finalizeDetachedStreamEnd({
      capturedMessageId: input.bootstrap.capturedMessageId,
      streamResult: input.bootstrap.streamResult,
      isAborted: input.abortSignal.aborted,
      lastStreamError,
      lifecycleAdapter: input.bootstrap.lifecycleAdapter,
      mirroredToolChunkState: input.bootstrap.mirroredToolChunkState,
      mirroredDurableOutput,
      incompleteToolCallsPartErrorText,
      cleanup: input.bootstrap.cleanup,
      logger: input.logger,
    });
  };

  const fail = async (error: unknown) => {
    await input.runContext.withContext(async () => {
      input.bootstrap.rootStreamWatchdog.dispose();
      await input.bootstrap.cleanup().catch((cleanupError: unknown) => {
        logCleanupError({ error: cleanupError, logger: input.logger });
      });
      await finalizeExecutionFailure({
        lifecycleAdapter: input.bootstrap.lifecycleAdapter,
        error,
        conversationId: input.bootstrap.capturedConversationId,
        runId: input.bootstrap.lifecycleAdapter.durableRootRun?.runId,
        logMessage: "Failed to mark durable chat root run as failed",
        logger: input.logger,
      });
    });
  };

  const streamOptions: HostedChatRuntimeToUiMessageStreamOptions = {
    sendReasoning: true,
    originalMessages: input.originalMessages,
    onError: (error) => {
      lastStreamError = error;
      return input.runContext.withContext(() => getHostedStreamErrorText(error));
    },
    onFinish: ({ responseMessage, isAborted }) => {
      finishHandlerStarted = true;
      finishPromise = input.runContext.withContext(() =>
        finalizeResponseFinish({
          responseMessage,
          isAborted,
          streamResult: input.bootstrap.streamResult,
          lastStreamError,
          lifecycleAdapter: input.bootstrap.lifecycleAdapter,
          mirroredToolChunkState: input.bootstrap.mirroredToolChunkState,
          capturedMessageId: input.bootstrap.capturedMessageId,
          incompleteToolCallsPartErrorText,
          cleanup: input.bootstrap.cleanup,
          logger: input.logger,
        }).catch((error) =>
          finalizeExecutionFailure({
            lifecycleAdapter: input.bootstrap.lifecycleAdapter,
            error,
            conversationId: input.bootstrap.capturedConversationId,
            runId: input.bootstrap.lifecycleAdapter.durableRootRun?.runId,
            logMessage: "Failed to finalize durable chat root run",
            logger: input.logger,
          })
        )
      );
    },
    messageMetadata: createStreamMessageMetadataBuilder({
      agentId: input.agentId,
      modelId: input.modelId,
      lifecycleAdapter: input.bootstrap.lifecycleAdapter,
      streamingMessageId,
    }),
  };

  if (input.responseMessageId) {
    const responseMessageId = input.responseMessageId;
    streamOptions.generateMessageId = () => responseMessageId;
  }
  const agentUIStream = input.bootstrap.streamResult.toUIMessageStream(streamOptions);

  return {
    agentUIStream: createHostedMirroredUiStream({
      sourceStream: agentUIStream,
      rootStreamWatchdog: input.bootstrap.rootStreamWatchdog,
      mirroredToolChunkState: input.bootstrap.mirroredToolChunkState,
      appendChunk: (chunk) => input.bootstrap.lifecycleAdapter.durableRunMirror?.handleChunk(chunk),
      setMirroredOutput: (value) => {
        mirroredDurableOutput = value;
      },
      logger: input.logger,
    }),
    fail,
    waitForFinish: async () => {
      try {
        await finalizeDetachedStreamEndIfNeeded();
        await finishPromise;
      } finally {
        input.bootstrap.rootStreamWatchdog.dispose();
      }
    },
  };
}
