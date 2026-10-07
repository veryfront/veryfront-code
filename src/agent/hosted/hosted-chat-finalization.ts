import {
  invalidateHostedAgentPauseSettlement,
  recordHostedAgentPauseFlush,
  recordHostedAgentPauseMirrorSnapshot,
} from "./manual-pause-settlement.ts";
import { extractChatMessageMetadata } from "../../chat/chat-ui-message-helpers.ts";
import { isToolUiPart } from "../../chat/conversation.ts";
import { buildFallbackUiMessageParts, getLastStreamStep } from "../../chat/final-step-fallback.ts";
import type { ChatUiMessage, ChatUiMessageChunk, MessageMetadata } from "../../chat/types.ts";
import {
  type ConversationHostedTerminalStateInput,
  dispatchConversationHostedTerminalState,
  resolveConversationHostedTerminalState,
  toConversationHostedTerminalState,
} from "../conversation/hosted-terminal.ts";
import {
  type MirroredToolChunkState,
  recordMirroredToolChunkState,
} from "../streaming/mirrored-tool-chunk-state.ts";
import { hasCompletedStepSignal, isStreamTimeoutError } from "../streaming/stream-outcome.ts";
import type { HostedChatExecutionLifecycleAdapter } from "./chat-execution-lifecycle-types.ts";
import { hasHostedAgentPauseStopped } from "./manual-pause-credential.ts";
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
    | {
      kind: "detached";
      isAborted: boolean;
      mirroredDurableOutput: boolean;
      mirroredMessage?: ChatUiMessage;
    }
  );

type HostedResponseFinalizationState = {
  persistedMessage: ChatUiMessage;
  finalizedMessage: ChatUiMessage;
  fallbackChunks: readonly ChatUiMessageChunk<MessageMetadata>[];
  hasIncompleteToolParts: boolean;
  metadata?: HostedLifecycleTerminalState["metadata"];
};

type HostedDetachedFinalizationState = {
  finalizedMessage: ChatUiMessage;
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
    let { finalizedFallbackMessage, hasIncompleteFallbackToolParts } =
      buildDetachedFallbackMessageState({
        capturedMessageId: input.capturedMessageId,
        finalStep,
        isAborted: input.isAborted,
        incompleteToolCallsPartErrorText: input.incompleteToolCallsPartErrorText,
      });
    if (input.mirroredMessage?.parts.length) {
      const recoveredFallback = buildFallbackUiMessageParts(finalStep);
      const fallbackTools = new Map(
        recoveredFallback.filter(isToolUiPart).map(
          (part) => [part.toolCallId, part],
        ),
      );
      const recoveredParts = input.mirroredMessage.parts.map((part) => {
        if (!isToolUiPart(part)) return part;
        const fallback = fallbackTools.get(part.toolCallId);
        fallbackTools.delete(part.toolCallId);
        if (
          part.state === "output-available" || part.state === "output-error" ||
          part.state === "output-denied"
        ) return part;
        if (
          !fallback ||
          (fallback.state !== "output-available" && fallback.state !== "output-error" &&
            fallback.state !== "output-denied")
        ) return part;
        return {
          ...part,
          state: fallback.state,
          input: part.state === "input-streaming" || part.state === "pending"
            ? fallback.input
            : part.input,
          output: fallback.output,
          errorText: fallback.errorText,
        };
      });
      const mirrored = buildFinalizedMessageState({
        responseMessage: {
          ...input.mirroredMessage,
          parts: [
            ...recoveredParts,
            ...(recoveredParts.some((part) => part.type === "reasoning")
              ? []
              : recoveredFallback.filter((part) => part.type === "reasoning")),
            ...fallbackTools.values(),
          ],
        },
        isAborted: input.isAborted,
        finalStep,
        incompleteToolCallsPartErrorText: input.incompleteToolCallsPartErrorText,
      });
      finalizedFallbackMessage = mirrored.sanitizedFinalizedMessage;
      hasIncompleteFallbackToolParts = mirrored.hasIncompleteFinalizedToolParts;
    }
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
      finalizedMessage: finalizedFallbackMessage,
      hasContent: fallbackParts.some((part) => part.type !== "step-start"),
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
    !isStreamTimeoutError(input.streamError)
  ) {
    return false;
  }

  return true;
}

async function appendFallbackChunks(
  input: {
    chunks: readonly ChatUiMessageChunk<MessageMetadata>[];
    lifecycleAdapter: HostedChatExecutionLifecycleAdapter;
    mirroredToolChunkState: MirroredToolChunkState;
  },
): Promise<void> {
  const mirror = input.lifecycleAdapter.durableRunMirror;
  if (!mirror) return;
  for (const chunk of input.chunks) {
    await mirror.handleChunk(chunk);
    recordMirroredToolChunkState(input.mirroredToolChunkState, chunk);
  }
}

async function flushMirror(
  lifecycleAdapter: HostedChatExecutionLifecycleAdapter,
): Promise<void> {
  await lifecycleAdapter.durableRunMirror?.flush();
}

/**
 * True once the durable run mirror has been told by the API that the run is already
 * terminal (veryfront-issue-inbox#743). Deleting a project cancels its in-flight
 * runs before the cascade removes them, so the append that follows is rejected with
 * `Cannot append external events to a terminal run` and the row is gone moments
 * later. Completing such a run can only fail, so finalization is skipped.
 *
 * This deliberately keys on the one narrow reason and no other: every other mirror
 * stop leaves a live run that still has to be completed.
 */
export function isDurableRunKnownTerminal(
  lifecycleAdapter: HostedChatExecutionLifecycleAdapter,
): boolean {
  return lifecycleAdapter.durableRunMirror?.getSnapshot().disableReason === "run_terminal";
}

async function dispatchTerminalState(
  input: {
    lifecycleAdapter: HostedChatExecutionLifecycleAdapter;
    terminalState: HostedLifecycleTerminalState;
  },
): Promise<void> {
  await dispatchConversationHostedTerminalState(input.lifecycleAdapter, input.terminalState, {
    skipDurableRunFinalization: isDurableRunKnownTerminal(input.lifecycleAdapter),
  });
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
  if (hasHostedAgentPauseStopped(input.lifecycleAdapter)) {
    if (input.streamError) {
      invalidateHostedAgentPauseSettlement(input.lifecycleAdapter, input.streamError);
    }
    try {
      const snapshot = await input.lifecycleAdapter.durableRunMirror?.flush();
      recordHostedAgentPauseMirrorSnapshot(input.lifecycleAdapter, snapshot);
    } catch (error) {
      recordHostedAgentPauseFlush(input.lifecycleAdapter, false);
      input.logger?.error("Paused agent output could not be flushed", { error: String(error) });
    } finally {
      await cleanupAfterFinalization({ cleanup: input.cleanup, logger: input.logger });
    }
    return;
  }
  const finalStep = await getLastStreamStep(input.streamResult);

  let fallbackChunks: readonly ChatUiMessageChunk<MessageMetadata>[];
  let hasIncompleteToolParts: boolean;
  let metadata: HostedLifecycleTerminalState["metadata"] | undefined;
  let emptyFailure: boolean;
  let hasOutput: boolean;
  let output: ChatUiMessage | undefined;

  if (input.kind === "response") {
    const state = createHostedChatFinalizeResponseBuildState(input)(finalStep);

    output = state.finalizedMessage;
    fallbackChunks = state.fallbackChunks;
    hasIncompleteToolParts = state.hasIncompleteToolParts;
    metadata = state.metadata;
    emptyFailure = state.fallbackChunks.length === 0 &&
      shouldFailEmptyHostedFinalizedMessage({
        isAborted: input.isAborted,
        message: state.finalizedMessage,
      });
    hasOutput = true;
  } else {
    const state = createHostedChatFinalizeDetachedBuildState(input)(finalStep);

    // A detached run can complete on mirrored output alone (for example a late
    // provider body-read failure leaves the final step empty). The empty
    // fallback message is not the run's result, so omit it rather than
    // persisting an empty business output over the mirrored response.
    output = state.hasContent ? state.finalizedMessage : undefined;
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
    mirroredToolChunkState: input.mirroredToolChunkState,
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
      ...(terminalState.status === "completed" && output !== undefined ? { output } : {}),
      ...(metadata !== undefined ? { metadata } : {}),
    },
  });
  await cleanupAfterFinalization({ cleanup: input.cleanup, logger: input.logger });
}
