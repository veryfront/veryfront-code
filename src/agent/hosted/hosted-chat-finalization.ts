import { extractChatMessageMetadata } from "../../chat/chat-ui-message-helpers.ts";
import { isToolUiPart } from "../../chat/conversation.ts";
import { getLastStreamStep } from "../../chat/final-step-fallback.ts";
import type { ChatUiMessage, ChatUiMessageChunk, MessageMetadata } from "../../chat/types.ts";
import {
  type ConversationHostedTerminalStateInput,
  dispatchConversationHostedTerminalState,
  resolveConversationHostedTerminalState,
  toConversationHostedTerminalState,
} from "../conversation/hosted-terminal.ts";
import type { MirroredToolChunkState } from "../streaming/mirrored-tool-chunk-state.ts";
import {
  hasCompletedStepSignal,
  isLateProviderBodyReadError,
} from "../streaming/stream-outcome.ts";
import type { HostedChatExecutionLifecycleAdapter } from "./chat-execution-lifecycle-types.ts";
import {
  buildDetachedFallbackChunks,
  buildDetachedFallbackMessageState,
  buildFinalizedMessageFallbackChunks,
  buildFinalizedMessageState,
} from "./finalized-message.ts";
import type { HostedLifecycleTerminalState } from "./lifecycle.ts";
import {
  getEmptyHostedFinalizedMessageTerminalError,
  shouldFailEmptyHostedFinalizedMessage,
} from "./stream-terminal-error.ts";

const FINALIZATION_TERMINAL_STATE_FALLBACK_MODEL_ID = "";

type HostedChatFinalizationLogger = {
  error: (message: string, metadata?: Record<string, unknown>) => void;
};

export type HostedChatFinalizationCommon = {
  streamResult: { steps: PromiseLike<readonly unknown[]> };
  lifecycleAdapter: HostedChatExecutionLifecycleAdapter;
  mirroredToolChunkState: MirroredToolChunkState;
  capturedMessageId: string | null;
  incompleteToolCallsPartErrorText: string;
  cleanup: () => Promise<void>;
  logger?: HostedChatFinalizationLogger;
  streamError?: unknown | null;
};

export type FinalizeHostedChatRunInput =
  & HostedChatFinalizationCommon
  & (
    | { kind: "response"; responseMessage: ChatUiMessage; isAborted: boolean }
    | { kind: "detached"; isAborted: boolean; mirroredDurableOutput: boolean }
  );

type HostedResponseFinalizationState = {
  persistedMessage: ChatUiMessage;
  finalizedMessage: ChatUiMessage;
  fallbackChunks: readonly ChatUiMessageChunk<MessageMetadata>[];
  hasIncompleteToolParts: boolean;
  metadata?: HostedLifecycleTerminalState["metadata"];
};

type HostedDetachedFinalizationState = {
  hasContent: boolean;
  fallbackChunks: readonly ChatUiMessageChunk<MessageMetadata>[];
  hasIncompleteToolParts: boolean;
};

function createHostedChatFinalizeResponseBuildState(
  input: Extract<FinalizeHostedChatRunInput, { kind: "response" }>,
): (finalStep: unknown) => HostedResponseFinalizationState {
  return (finalStep) => {
    const { persistedMessage, sanitizedFinalizedMessage, hasIncompleteFinalizedToolParts } =
      buildFinalizedMessageState({
        responseMessage: input.responseMessage,
        isAborted: input.isAborted,
        finalStep,
        incompleteToolCallsPartErrorText: input.incompleteToolCallsPartErrorText,
      });

    const fallbackChunks =
      sanitizedFinalizedMessage.parts.length > 0 && input.lifecycleAdapter.durableRunMirror
        ? (() => {
          const primaryChunks = buildFinalizedMessageFallbackChunks({
            persistedMessage,
            sanitizedFinalizedMessage,
            finalStep,
            mirroredToolChunkState: input.mirroredToolChunkState,
            capturedMessageId: input.capturedMessageId,
            hasIncompleteFinalizedToolParts,
          });

          return [
            ...primaryChunks,
            ...buildMissingToolOutputErrorChunksFromParts({
              parts: sanitizedFinalizedMessage.parts,
              mirroredToolChunkState: input.mirroredToolChunkState,
              primaryChunks,
            }),
          ];
        })()
        : [];

    return {
      persistedMessage,
      finalizedMessage: sanitizedFinalizedMessage,
      fallbackChunks,
      hasIncompleteToolParts: hasIncompleteFinalizedToolParts,
      metadata: extractChatMessageMetadata(sanitizedFinalizedMessage.metadata),
    };
  };
}

function createHostedChatFinalizeDetachedBuildState(
  input: Extract<FinalizeHostedChatRunInput, { kind: "detached" }>,
): (finalStep: unknown) => HostedDetachedFinalizationState {
  return (finalStep) => {
    const { finalizedFallbackMessage, hasIncompleteFallbackToolParts } =
      buildDetachedFallbackMessageState({
        capturedMessageId: input.capturedMessageId,
        finalStep,
        isAborted: input.isAborted,
        incompleteToolCallsPartErrorText: input.incompleteToolCallsPartErrorText,
      });
    const fallbackParts = finalizedFallbackMessage.parts;

    const fallbackChunks = fallbackParts.length > 0 && input.lifecycleAdapter.durableRunMirror &&
        input.capturedMessageId
      ? (() => {
        const primaryChunks = buildDetachedFallbackChunks({
          fallbackParts,
          finalStep,
          mirroredToolChunkState: input.mirroredToolChunkState,
          mirroredDurableOutput: input.mirroredDurableOutput,
          capturedMessageId: input.capturedMessageId,
          hasIncompleteFallbackToolParts,
        });

        return [
          ...primaryChunks,
          ...buildMissingToolOutputErrorChunksFromParts({
            parts: fallbackParts,
            mirroredToolChunkState: input.mirroredToolChunkState,
            primaryChunks,
          }),
        ];
      })()
      : [];

    return {
      hasContent: fallbackParts.length > 0,
      fallbackChunks,
      hasIncompleteToolParts: hasIncompleteFallbackToolParts,
    };
  };
}

function buildMissingToolOutputErrorChunksFromParts(input: {
  parts: ChatUiMessage["parts"];
  mirroredToolChunkState: MirroredToolChunkState;
  primaryChunks: readonly ChatUiMessageChunk<MessageMetadata>[];
}): ChatUiMessageChunk<MessageMetadata>[] {
  const chunks: ChatUiMessageChunk<MessageMetadata>[] = [];
  const outputErrorToolCallIds = new Set(input.mirroredToolChunkState.outputErrorToolCallIds);
  const outputAvailableToolCallIds = new Set(
    input.mirroredToolChunkState.outputAvailableToolCallIds,
  );
  const outputDeniedToolCallIds = new Set(input.mirroredToolChunkState.outputDeniedToolCallIds);

  for (const chunk of input.primaryChunks) {
    if (chunk.type === "tool-output-error") {
      outputErrorToolCallIds.add(chunk.toolCallId);
      continue;
    }

    if (chunk.type === "tool-output-available") {
      outputAvailableToolCallIds.add(chunk.toolCallId);
      continue;
    }

    if (chunk.type === "tool-output-denied") {
      outputDeniedToolCallIds.add(chunk.toolCallId);
    }
  }

  for (const part of input.parts) {
    if (
      !isToolUiPart(part) || part.state !== "output-error" ||
      outputErrorToolCallIds.has(part.toolCallId) ||
      outputAvailableToolCallIds.has(part.toolCallId) ||
      outputDeniedToolCallIds.has(part.toolCallId)
    ) {
      continue;
    }

    chunks.push({
      type: "tool-output-error",
      toolCallId: part.toolCallId,
      errorText: typeof part.errorText === "string" ? part.errorText : "Tool execution failed",
    });
    outputErrorToolCallIds.add(part.toolCallId);
  }

  return chunks;
}

function toHostedChatExecutionFinalState(
  input: ConversationHostedTerminalStateInput,
): HostedLifecycleTerminalState {
  return toConversationHostedTerminalState({
    state: input,
    fallbackModelId: FINALIZATION_TERMINAL_STATE_FALLBACK_MODEL_ID,
  });
}

async function cleanupAfterFinalization(input: {
  cleanup: () => Promise<void>;
  logger?: HostedChatFinalizationLogger;
}): Promise<void> {
  await input.cleanup().catch((cleanupError: unknown) => {
    input.logger?.error("Runtime cleanup failed during finalization", {
      error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
    });
  });
}

function hasFinalStepCompletionSignal(finalStep: unknown): boolean {
  if (
    typeof finalStep !== "object" || finalStep === null || !("finishReason" in finalStep) ||
    typeof finalStep.finishReason !== "string"
  ) {
    return false;
  }

  return hasCompletedStepSignal(finalStep.finishReason);
}

function shouldFailStreamError(input: {
  isAborted: boolean;
  hasOutput: boolean;
  finalStep: unknown;
  streamError?: unknown | null;
}): boolean {
  if (input.isAborted || input.streamError == null) {
    return false;
  }

  if (
    input.hasOutput &&
    hasFinalStepCompletionSignal(input.finalStep) &&
    isLateProviderBodyReadError(input.streamError)
  ) {
    return false;
  }

  return true;
}

async function appendFallbackChunks(
  input: {
    chunks: readonly ChatUiMessageChunk<MessageMetadata>[];
    lifecycleAdapter: HostedChatExecutionLifecycleAdapter;
  },
): Promise<void> {
  for (const chunk of input.chunks) {
    await input.lifecycleAdapter.durableRunMirror?.handleChunk(chunk);
  }
}

async function flushMirror(
  lifecycleAdapter: HostedChatExecutionLifecycleAdapter,
): Promise<void> {
  await lifecycleAdapter.durableRunMirror?.flush();
}

async function dispatchTerminalState(
  input: {
    lifecycleAdapter: HostedChatExecutionLifecycleAdapter;
    terminalState: HostedLifecycleTerminalState;
  },
): Promise<void> {
  await dispatchConversationHostedTerminalState(input.lifecycleAdapter, input.terminalState);
}

async function dispatchFailedTerminalError(
  input: {
    lifecycleAdapter: HostedChatExecutionLifecycleAdapter;
    finalStep: unknown;
    streamError?: unknown | null;
    metadata?: HostedLifecycleTerminalState["metadata"];
  },
): Promise<void> {
  const terminalError = getEmptyHostedFinalizedMessageTerminalError({
    finalStep: input.finalStep,
    streamError: input.streamError,
  });

  await dispatchTerminalState({
    lifecycleAdapter: input.lifecycleAdapter,
    terminalState: {
      status: "failed",
      ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
      terminalErrorCode: terminalError.code,
      terminalErrorMessage: terminalError.message,
    },
  });
}

function resolveTerminalState(input: {
  isAborted: boolean;
  hasIncompleteToolParts: boolean;
}): HostedLifecycleTerminalState {
  return toHostedChatExecutionFinalState(
    resolveConversationHostedTerminalState({
      isAborted: input.isAborted,
      hasIncompleteToolParts: input.hasIncompleteToolParts,
    }),
  );
}

export async function finalizeHostedChatRun(
  input: FinalizeHostedChatRunInput,
): Promise<void> {
  const finalStep = await getLastStreamStep(input.streamResult);

  let fallbackChunks: readonly ChatUiMessageChunk<MessageMetadata>[];
  let hasIncompleteToolParts: boolean;
  let metadata: HostedLifecycleTerminalState["metadata"] | undefined;
  let emptyFailure: boolean;
  let hasOutput: boolean;

  if (input.kind === "response") {
    const state = createHostedChatFinalizeResponseBuildState(input)(finalStep);

    fallbackChunks = state.fallbackChunks;
    hasIncompleteToolParts = state.hasIncompleteToolParts;
    metadata = state.metadata;
    emptyFailure = shouldFailEmptyHostedFinalizedMessage({
      isAborted: input.isAborted,
      message: state.finalizedMessage,
    });
    hasOutput = true;
  } else {
    const state = createHostedChatFinalizeDetachedBuildState(input)(finalStep);

    fallbackChunks = state.fallbackChunks;
    hasIncompleteToolParts = state.hasIncompleteToolParts;
    metadata = undefined;
    emptyFailure = !input.isAborted && !input.mirroredDurableOutput && !state.hasContent;
    hasOutput = input.mirroredDurableOutput || state.hasContent;
  }

  if (emptyFailure) {
    await flushMirror(input.lifecycleAdapter);
    await dispatchFailedTerminalError({
      lifecycleAdapter: input.lifecycleAdapter,
      finalStep,
      streamError: input.streamError,
      metadata,
    });
    await cleanupAfterFinalization({ cleanup: input.cleanup, logger: input.logger });
    return;
  }

  await appendFallbackChunks({
    chunks: fallbackChunks,
    lifecycleAdapter: input.lifecycleAdapter,
  });
  await flushMirror(input.lifecycleAdapter);

  if (
    shouldFailStreamError({
      isAborted: input.isAborted,
      hasOutput,
      finalStep,
      streamError: input.streamError,
    })
  ) {
    await dispatchFailedTerminalError({
      lifecycleAdapter: input.lifecycleAdapter,
      finalStep,
      streamError: input.streamError,
      metadata,
    });
    await cleanupAfterFinalization({ cleanup: input.cleanup, logger: input.logger });
    return;
  }

  const terminalState = resolveTerminalState({
    isAborted: input.isAborted,
    hasIncompleteToolParts,
  });
  await dispatchTerminalState({
    lifecycleAdapter: input.lifecycleAdapter,
    terminalState: {
      ...terminalState,
      ...(metadata !== undefined ? { metadata } : {}),
    },
  });
  await cleanupAfterFinalization({ cleanup: input.cleanup, logger: input.logger });
}
