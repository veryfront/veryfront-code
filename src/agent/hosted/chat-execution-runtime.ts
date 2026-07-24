import {
  buildChatStreamChunkMessageMetadata,
  extractChatMessageMetadata,
} from "../../chat/chat-ui-message-helpers.ts";
import { INVALID_ARGUMENT } from "#veryfront/errors";
import type { ChatUiMessage, ChatUiMessageChunk, MessageMetadata } from "../../chat/types.ts";
import type { HostedConversationRootRunContext } from "../conversation/root-run-lifecycle.ts";
import {
  createHostedAgentRunSpanController,
  createHostedRootRunLifecycleRuntimeAdapter,
  type CreateHostedRootRunLifecycleRuntimeAdapterInput,
  type HostedAgentRunSpanController,
  type HostedAgentRunTracer,
} from "./agent-run-lifecycle.ts";
import {
  buildDetachedFallbackChunks,
  buildDetachedFallbackMessageState,
  buildFinalizedMessageFallbackChunks,
  buildFinalizedMessageState,
} from "./finalized-message.ts";
import type {
  HostedChatRuntimeAgent,
  HostedChatRuntimeStreamInput,
  HostedChatRuntimeStreamResult,
  HostedChatRuntimeToUiMessageStreamOptions,
} from "./chat-runtime-contract.ts";
import type { HostedLifecycleTerminalState } from "./lifecycle.ts";
import {
  type ConversationHostedTerminalStateInput,
  dispatchConversationHostedStreamErrorState,
  dispatchConversationHostedTerminalState,
  resolveConversationHostedTerminalState,
  toConversationHostedTerminalState,
} from "../conversation/hosted-terminal.ts";
import {
  createHostedMirroredUiStream,
  createMirroredToolChunkState,
  type MirroredToolChunkState,
} from "../streaming/mirrored-tool-chunk-state.ts";
import {
  type FinalizeHostedResponseOptions,
  type HostedDetachedFinalizationState,
  type HostedResponseFinalizationState,
} from "./stream-finalization.ts";
import {
  getEmptyHostedFinalizedMessageTerminalError,
  getHostedStreamErrorText,
} from "./stream-terminal-error.ts";
import type { BuildChatStreamChunkMessageMetadataInput } from "../../chat/chat-ui-message-helpers.ts";
import {
  createChatStreamWatchdog,
  DEFAULT_CHAT_STREAM_TOOL_RUNNING_TIMEOUT_MS,
} from "../../chat/stream-watchdog.ts";
import { unrefTimer } from "../../platform/compat/process.ts";
import type { HostedChatExecutionLifecycleAdapter } from "./chat-execution-lifecycle-types.ts";
import { AGENT_DELEGATE_TOOL_PREFIX } from "../runtime/agent-delegation-names.ts";
import { finalizeHostedChatRun } from "./hosted-chat-finalization.ts";
export type { HostedChatExecutionLifecycleAdapter } from "./chat-execution-lifecycle-types.ts";

const INCOMPLETE_TOOL_CALLS_PART_ERROR_TEXT = "Assistant ended before tool execution completed";

const FINALIZATION_TERMINAL_STATE_FALLBACK_MODEL_ID = "";
const DEFAULT_STREAM_BOOTSTRAP_KEEPALIVE_INTERVAL_MS = 30_000;
const DEFAULT_STREAM_BOOTSTRAP_TIMEOUT_MS = DEFAULT_CHAT_STREAM_TOOL_RUNNING_TIMEOUT_MS;

/** Public API contract for hosted chat execution runtime. */
export interface HostedChatExecutionRuntime {
  agentUIStream: AsyncIterable<ChatUiMessageChunk<MessageMetadata>>;
  fail: (error: unknown) => Promise<void>;
  waitForFinish: () => Promise<void>;
}

/** Public API contract for hosted chat execution runtime logger. */
export interface HostedChatExecutionRuntimeLogger {
  error: (message: string, metadata?: Record<string, unknown>) => void;
  warn: (message: string, metadata?: Record<string, unknown>) => void;
}

/** Context for hosted chat execution run. */
export interface HostedChatExecutionRunContext {
  withContext: <T>(fn: () => T) => T;
  setMessageId?: (messageId: string) => void;
}

/** Public API contract for hosted chat execution root stream watchdog. */
export type HostedChatExecutionRootStreamWatchdog = ReturnType<typeof createChatStreamWatchdog>;

/** Public API contract for hosted chat execution runtime bootstrap. */
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

/** Input payload for create hosted chat execution runtime bootstrap. */
export interface CreateHostedChatExecutionRuntimeBootstrapInput {
  agent: HostedChatRuntimeAgent;
  cleanup: () => Promise<void>;
  lifecycleAdapter: HostedChatExecutionLifecycleAdapter;
  finalMessages: HostedChatRuntimeStreamInput["messages"];
  conversationId?: string;
  abortSignal: AbortSignal;
  traceStream?: <T>(operation: () => Promise<T>) => Promise<T>;
  createRootStreamWatchdog?: () => HostedChatExecutionRootStreamWatchdog;
  streamBootstrapKeepaliveIntervalMs?: number;
  streamBootstrapTimeoutMs?: number;
}

/** Input payload for create hosted chat execution runtime. */
export interface CreateHostedChatExecutionRuntimeInput {
  agentId: string;
  agentName?: string;
  agentAvatarUrl?: string;
  modelId: string;
  originalMessages: ChatUiMessage[];
  responseMessageId?: string;
  runContext: HostedChatExecutionRunContext;
  abortSignal: AbortSignal;
  bootstrap: HostedChatExecutionRuntimeBootstrap;
  logger?: HostedChatExecutionRuntimeLogger;
  incompleteToolCallsPartErrorText?: string;
}

/** Input payload for create bootstrapped hosted chat execution runtime. */
export interface CreateBootstrappedHostedChatExecutionRuntimeInput {
  authToken: string;
  apiUrl: string;
  agent: HostedChatRuntimeAgent;
  agentId: string;
  agentName?: string;
  agentAvatarUrl?: string;
  modelId: string;
  cleanup: () => Promise<void>;
  messages: ChatUiMessage[];
  finalMessages: HostedChatRuntimeStreamInput["messages"];
  conversationId?: string;
  projectId: string | null;
  userId: string;
  rootRunContext: HostedConversationRootRunContext;
  abortSignal: AbortSignal;
  responseMessageId?: string;
  upstreamParentConversationId?: string;
  upstreamParentRunId?: string;
  spawnedFromToolCallId?: string;
  traceAttributes?: Parameters<HostedAgentRunSpanController["setAttributes"]>[0];
  tracer: HostedAgentRunTracer;
  resolveProvider: (modelId: string) => string;
  traceStream?: CreateHostedChatExecutionRuntimeBootstrapInput["traceStream"];
  logger?: HostedChatExecutionRuntimeLogger;
  spanName?: string;
  terminalErrorCode?: string;
  incompleteToolCallsPartErrorText?: string;
  createRootStreamWatchdog?: CreateHostedChatExecutionRuntimeBootstrapInput[
    "createRootStreamWatchdog"
  ];
  streamBootstrapKeepaliveIntervalMs?: CreateHostedChatExecutionRuntimeBootstrapInput[
    "streamBootstrapKeepaliveIntervalMs"
  ];
  streamBootstrapTimeoutMs?: CreateHostedChatExecutionRuntimeBootstrapInput[
    "streamBootstrapTimeoutMs"
  ];
  createTerminalAdapter?: CreateHostedRootRunLifecycleRuntimeAdapterInput[
    "createTerminalAdapter"
  ];
}

/** Public API contract for bootstrapped hosted chat execution runtime. */
export interface BootstrappedHostedChatExecutionRuntime {
  agentRunSpan: HostedAgentRunSpanController;
  execution: HostedChatExecutionRuntime;
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

/** State for to hosted chat execution final. */
export function toHostedChatExecutionFinalState(
  input: ConversationHostedTerminalStateInput,
): HostedLifecycleTerminalState {
  return toConversationHostedTerminalState({
    state: input,
    fallbackModelId: FINALIZATION_TERMINAL_STATE_FALLBACK_MODEL_ID,
  });
}

/** Cleanup after hosted chat execution finalization helper. */
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

// `invoke_agent` can legitimately run longer than the idle timeout (it delegates
// to a sub-agent), so hosted runs must exempt it from the watchdog's idle abort.
// The shared watchdog no longer bakes this product-specific name into its default,
// so the exemption is passed explicitly here at the hosted call site.
const HOSTED_LONG_RUNNING_TOOL_NAMES = ["invoke_agent"] as const;

function createDefaultHostedChatExecutionRootStreamWatchdog(): HostedChatExecutionRootStreamWatchdog {
  return createChatStreamWatchdog({
    longRunningToolNames: HOSTED_LONG_RUNNING_TOOL_NAMES,
    longRunningToolPrefixes: [AGENT_DELEGATE_TOOL_PREFIX],
  });
}

function resolveStreamBootstrapKeepaliveIntervalMs(intervalMs: number | undefined): number {
  if (typeof intervalMs !== "number" || !Number.isFinite(intervalMs) || intervalMs <= 0) {
    return DEFAULT_STREAM_BOOTSTRAP_KEEPALIVE_INTERVAL_MS;
  }

  return intervalMs;
}

function resolveStreamBootstrapTimeoutMs(timeoutMs: number | undefined): number {
  if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return DEFAULT_STREAM_BOOTSTRAP_TIMEOUT_MS;
  }

  return timeoutMs;
}

function createStreamBootstrapWatchdogKeepalive(input: {
  rootStreamWatchdog: HostedChatExecutionRootStreamWatchdog;
  intervalMs?: number;
  timeoutMs?: number;
}): {
  signal: AbortSignal;
  dispose: () => void;
} {
  const intervalMs = resolveStreamBootstrapKeepaliveIntervalMs(input.intervalMs);
  const timeoutMs = resolveStreamBootstrapTimeoutMs(input.timeoutMs);
  const timeoutController = new AbortController();
  const interval = setInterval(() => {
    input.rootStreamWatchdog.keepAlive();
  }, intervalMs);
  const timeout = setTimeout(() => {
    timeoutController.abort(
      new DOMException(`Chat stream bootstrap timeout after ${timeoutMs}ms`, "AbortError"),
    );
    clearInterval(interval);
  }, timeoutMs);
  unrefTimer(interval);
  unrefTimer(timeout);

  return {
    signal: timeoutController.signal,
    dispose: () => {
      clearInterval(interval);
      clearTimeout(timeout);
    },
  };
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

/** Create hosted chat execution runtime bootstrap. */
export async function createHostedChatExecutionRuntimeBootstrap(
  input: CreateHostedChatExecutionRuntimeBootstrapInput,
): Promise<HostedChatExecutionRuntimeBootstrap> {
  const cleanup = createHostedChatExecutionCleanup(input.cleanup);
  const streamingMessageId = input.lifecycleAdapter.durableRootRun?.messageId ?? null;
  if (input.conversationId && !streamingMessageId) {
    throw INVALID_ARGUMENT.create({ detail: "DURABLE_CHAT_ROOT_REQUIRES_CONVERSATION" });
  }

  const rootStreamWatchdog = input.createRootStreamWatchdog
    ? input.createRootStreamWatchdog()
    : createDefaultHostedChatExecutionRootStreamWatchdog();
  const bootstrapKeepalive = createStreamBootstrapWatchdogKeepalive({
    rootStreamWatchdog,
    intervalMs: input.streamBootstrapKeepaliveIntervalMs,
    timeoutMs: input.streamBootstrapTimeoutMs,
  });
  const streamAbortSignal = AbortSignal.any([
    input.abortSignal,
    rootStreamWatchdog.signal,
    bootstrapKeepalive.signal,
  ]);

  let streamResult: HostedChatRuntimeStreamResult;
  try {
    streamResult = await traceHostedChatRuntimeStream(
      input.traceStream,
      () =>
        input.agent.stream({
          messages: input.finalMessages,
          abortSignal: streamAbortSignal,
        }),
    );
  } catch (error) {
    rootStreamWatchdog.dispose();
    throw error;
  } finally {
    bootstrapKeepalive.dispose();
  }

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

async function createBootstrappedHostedChatRuntime(
  input: CreateBootstrappedHostedChatExecutionRuntimeInput,
  agentRunSpan: HostedAgentRunSpanController,
): Promise<HostedChatExecutionRuntime> {
  const lifecycleAdapter = createHostedRootRunLifecycleRuntimeAdapter({
    authToken: input.authToken,
    apiUrl: input.apiUrl,
    modelId: input.modelId,
    durableRootRun: input.rootRunContext.durableRootRun,
    durableRunMirror: input.rootRunContext.durableRunMirror,
    agentRunSpan,
    resolveProvider: input.resolveProvider,
    ...(input.createTerminalAdapter ? { createTerminalAdapter: input.createTerminalAdapter } : {}),
  });
  let bootstrap: HostedChatExecutionRuntimeBootstrap;
  try {
    bootstrap = await createHostedChatExecutionRuntimeBootstrap({
      agent: input.agent,
      cleanup: input.cleanup,
      lifecycleAdapter,
      finalMessages: input.finalMessages,
      conversationId: input.conversationId,
      abortSignal: input.abortSignal,
      traceStream: input.traceStream,
      ...(input.createRootStreamWatchdog
        ? { createRootStreamWatchdog: input.createRootStreamWatchdog }
        : {}),
      streamBootstrapKeepaliveIntervalMs: input.streamBootstrapKeepaliveIntervalMs,
      streamBootstrapTimeoutMs: input.streamBootstrapTimeoutMs,
    });
  } catch (error) {
    await dispatchConversationHostedStreamErrorState(lifecycleAdapter, error).catch(
      (terminalError) => {
        input.logger?.error("Durable chat bootstrap failure finalization failed", {
          error: terminalError instanceof Error ? terminalError.message : String(terminalError),
        });
      },
    );
    await cleanupAfterHostedChatExecutionFinalization({
      cleanup: input.cleanup,
      logger: input.logger,
    });
    throw error;
  }

  return createHostedChatExecutionRuntime({
    agentId: input.agentId,
    ...(input.agentName ? { agentName: input.agentName } : {}),
    ...(input.agentAvatarUrl ? { agentAvatarUrl: input.agentAvatarUrl } : {}),
    modelId: input.modelId,
    originalMessages: input.messages,
    responseMessageId: input.responseMessageId,
    runContext: agentRunSpan,
    abortSignal: input.abortSignal,
    bootstrap,
    logger: input.logger,
    incompleteToolCallsPartErrorText: input.incompleteToolCallsPartErrorText,
  });
}

/** Create bootstrapped hosted chat execution runtime. */
export async function createBootstrappedHostedChatExecutionRuntime(
  input: CreateBootstrappedHostedChatExecutionRuntimeInput,
): Promise<BootstrappedHostedChatExecutionRuntime> {
  const agentRunSpan = createHostedAgentRunSpanController({
    tracer: input.tracer,
    spanName: input.spanName,
    operationName: "invoke_agent",
    conversationId: input.conversationId,
    projectId: input.projectId,
    userId: input.userId,
    agentId: input.agentId,
    agentName: input.agentName,
    modelId: input.modelId,
    rootRun: input.rootRunContext.durableRootRun,
    upstreamParentConversationId: input.upstreamParentConversationId,
    upstreamParentRunId: input.upstreamParentRunId,
    spawnedFromToolCallId: input.spawnedFromToolCallId,
    traceAttributes: input.traceAttributes,
  });

  try {
    const execution = await agentRunSpan.withContext(() =>
      createBootstrappedHostedChatRuntime(input, agentRunSpan)
    );
    return { agentRunSpan, execution };
  } catch (error) {
    agentRunSpan.finalize({
      status: "failed",
      modelId: input.modelId,
      terminalErrorCode: input.terminalErrorCode ?? "STREAM_ERROR",
      terminalErrorMessage: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/** Create hosted chat stream finalization hooks. */
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
    flushMirror: async () => {
      await input.lifecycleAdapter.durableRunMirror?.flush();
    },
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

/** State for create hosted chat finalize response build. */
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

/** State for create hosted chat finalize detached build. */
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
  agentName?: string;
  agentAvatarUrl?: string;
  modelId: string;
  lifecycleAdapter: HostedChatExecutionLifecycleAdapter;
  streamingMessageId: string | null;
}): HostedChatRuntimeToUiMessageStreamOptions["messageMetadata"] {
  return ({ part }) =>
    buildChatStreamChunkMessageMetadata(
      {
        agentId: input.agentId,
        ...(input.agentName ? { agentName: input.agentName } : {}),
        ...(input.agentAvatarUrl ? { agentAvatarUrl: input.agentAvatarUrl } : {}),
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
  await finalizeHostedChatRun({
    kind: "response",
    responseMessage: input.responseMessage,
    isAborted: input.isAborted,
    streamResult: input.streamResult,
    lifecycleAdapter: input.lifecycleAdapter,
    mirroredToolChunkState: input.mirroredToolChunkState,
    capturedMessageId: input.capturedMessageId,
    incompleteToolCallsPartErrorText: input.incompleteToolCallsPartErrorText,
    cleanup: input.cleanup,
    logger: input.logger,
    streamError: input.lastStreamError,
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
  await finalizeHostedChatRun({
    kind: "detached",
    isAborted: input.isAborted,
    mirroredDurableOutput: input.mirroredDurableOutput,
    streamResult: input.streamResult,
    lifecycleAdapter: input.lifecycleAdapter,
    capturedMessageId: input.capturedMessageId,
    mirroredToolChunkState: input.mirroredToolChunkState,
    incompleteToolCallsPartErrorText: input.incompleteToolCallsPartErrorText,
    cleanup: input.cleanup,
    logger: input.logger,
    streamError: input.lastStreamError,
  });
}

function resolveStreamingMessageId(input: {
  conversationId?: string;
  lifecycleAdapter: HostedChatExecutionLifecycleAdapter;
  runContext: HostedChatExecutionRunContext;
}): string | null {
  const streamingMessageId = input.lifecycleAdapter.durableRootRun?.messageId ?? null;
  if (input.conversationId && !streamingMessageId) {
    throw INVALID_ARGUMENT.create({ detail: "DURABLE_CHAT_ROOT_REQUIRES_CONVERSATION" });
  }

  if (streamingMessageId) {
    input.runContext.setMessageId?.(streamingMessageId);
  }

  return streamingMessageId;
}

/** Create hosted chat execution runtime. */
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
      ...(input.agentName ? { agentName: input.agentName } : {}),
      ...(input.agentAvatarUrl ? { agentAvatarUrl: input.agentAvatarUrl } : {}),
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
