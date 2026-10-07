import {
  hasIncompleteToolParts,
  isToolUiPart,
  markIncompleteToolPartsAsErrored,
  markIncompleteToolPartsAsStopped,
} from "../../chat/conversation.ts";
import {
  appendMissingFallbackTextPart,
  buildFallbackUiMessageChunks,
  buildFallbackUiMessageParts,
  buildMissingFallbackTextChunks,
  buildMissingFallbackToolChunks,
  buildMissingFallbackToolChunksFromParts,
} from "../../chat/final-step-fallback.ts";
import type { ChatUiMessage, ChatUiMessageChunk, MessageMetadata } from "#veryfront/chat/types.ts";
import {
  cloneMirroredToolChunkState,
  type MirroredToolChunkState,
  recordMirroredToolChunkState,
} from "../streaming/mirrored-tool-chunk-state.ts";

/** Input payload for build finalized message state. */
export interface BuildFinalizedMessageStateInput {
  responseMessage: ChatUiMessage;
  isAborted: boolean;
  finalStep: unknown;
  incompleteToolCallsPartErrorText: string;
}

/** Input payload for build detached fallback message. */
export interface BuildDetachedFallbackMessageInput {
  capturedMessageId: string | null;
  finalStep: unknown;
  isAborted: boolean;
  incompleteToolCallsPartErrorText: string;
}

/** State for finalized message. */
export interface FinalizedMessageState {
  persistedMessage: ChatUiMessage;
  sanitizedFinalizedMessage: ChatUiMessage;
  hasIncompleteFinalizedToolParts: boolean;
}

/** State for detached fallback message. */
export interface DetachedFallbackMessageState {
  finalizedFallbackMessage: ChatUiMessage;
  hasIncompleteFallbackToolParts: boolean;
}

/** Input payload for build finalized message fallback chunks. */
export interface BuildFinalizedMessageFallbackChunksInput {
  persistedMessage: ChatUiMessage;
  sanitizedFinalizedMessage: ChatUiMessage;
  finalStep: unknown;
  mirroredToolChunkState: MirroredToolChunkState;
  capturedMessageId: string | null;
  hasIncompleteFinalizedToolParts: boolean;
}

/** Input payload for build detached fallback chunks. */
export interface BuildDetachedFallbackChunksInput {
  fallbackParts: ChatUiMessage["parts"];
  finalStep: unknown;
  mirroredToolChunkState: MirroredToolChunkState;
  mirroredDurableOutput: boolean;
  capturedMessageId: string;
  hasIncompleteFallbackToolParts: boolean;
}

/** State for build finalized message. */
export function buildFinalizedMessageState(
  input: BuildFinalizedMessageStateInput,
): FinalizedMessageState {
  const persistedMessage = input.isAborted
    ? markIncompleteToolPartsAsStopped(input.responseMessage)
    : input.responseMessage;
  const finalStepFallbackParts = buildFallbackUiMessageParts(input.finalStep);
  const hasPersistedText = persistedMessage.parts.some((part) =>
    part.type === "text" && part.text.length > 0
  );
  const hasPersistedReasoning = persistedMessage.parts.some((part) =>
    part.type === "reasoning" &&
    (part.text.length > 0 || (part.signature?.length ?? 0) > 0 ||
      (part.redactedData?.length ?? 0) > 0)
  );
  const fallbackParts = persistedMessage.parts.length === 0
    ? finalStepFallbackParts
    : appendMissingFallbackTextPart([
      ...persistedMessage.parts,
      ...finalStepFallbackParts.filter((fallbackPart) =>
        (fallbackPart.type === "text" && !hasPersistedText) ||
        (fallbackPart.type === "reasoning" && !hasPersistedReasoning) ||
        (isToolUiPart(fallbackPart) &&
          !persistedMessage.parts.some((part) =>
            isToolUiPart(part) && part.toolCallId === fallbackPart.toolCallId
          ))
      ),
    ], input.finalStep);
  const finalizedMessage = fallbackParts.length !== persistedMessage.parts.length
    ? {
      ...persistedMessage,
      parts: fallbackParts,
    }
    : persistedMessage;
  const hasIncompleteFinalizedToolParts = !input.isAborted &&
    hasIncompleteToolParts(finalizedMessage);
  const sanitizedFinalizedMessage = hasIncompleteFinalizedToolParts
    ? markIncompleteToolPartsAsErrored(
      finalizedMessage,
      input.incompleteToolCallsPartErrorText,
    )
    : finalizedMessage;

  return {
    persistedMessage,
    sanitizedFinalizedMessage,
    hasIncompleteFinalizedToolParts,
  };
}

/** State for build detached fallback message. */
export function buildDetachedFallbackMessageState(
  input: BuildDetachedFallbackMessageInput,
): DetachedFallbackMessageState {
  const fallbackMessage: ChatUiMessage = {
    id: input.capturedMessageId ?? "detached-fallback-message",
    role: "assistant",
    parts: buildFallbackUiMessageParts(input.finalStep),
  };
  const hasIncompleteFallbackToolParts = !input.isAborted &&
    hasIncompleteToolParts(fallbackMessage);
  const finalizedFallbackMessage = hasIncompleteFallbackToolParts
    ? markIncompleteToolPartsAsErrored(
      fallbackMessage,
      input.incompleteToolCallsPartErrorText,
    )
    : fallbackMessage;

  return {
    finalizedFallbackMessage,
    hasIncompleteFallbackToolParts,
  };
}

/** Builds finalized message fallback chunks. */
export function buildFinalizedMessageFallbackChunks(
  input: BuildFinalizedMessageFallbackChunksInput,
): ChatUiMessageChunk<MessageMetadata>[] {
  const fallbackMessageId = input.sanitizedFinalizedMessage.id ||
    input.capturedMessageId;
  if (!fallbackMessageId) {
    return [];
  }

  const hasPersistedTextOrReasoning = input.persistedMessage.parts.some((part) =>
    (part.type === "text" && part.text.length > 0) ||
    (part.type === "reasoning" &&
      (part.text.length > 0 || (part.signature?.length ?? 0) > 0 ||
        (part.redactedData?.length ?? 0) > 0))
  );
  const hasOrderedFallbackText = buildFallbackUiMessageParts(input.finalStep).some((part) =>
    part.type === "text"
  );
  if (!hasPersistedTextOrReasoning && hasOrderedFallbackText) {
    const orderedFallbackChunks = buildFallbackUiMessageChunks(
      input.finalStep,
      fallbackMessageId,
      input.mirroredToolChunkState,
    );
    const mirroredToolChunkStateWithOrderedFallbacks = cloneMirroredToolChunkState(
      input.mirroredToolChunkState,
    );
    for (const chunk of orderedFallbackChunks) {
      recordMirroredToolChunkState(mirroredToolChunkStateWithOrderedFallbacks, chunk);
    }
    return [
      ...orderedFallbackChunks,
      ...buildMissingFallbackToolChunksFromParts(
        input.sanitizedFinalizedMessage.parts,
        mirroredToolChunkStateWithOrderedFallbacks,
      ),
    ];
  }

  const toolFallbackChunksFromParts = buildMissingFallbackToolChunksFromParts(
    input.sanitizedFinalizedMessage.parts,
    input.mirroredToolChunkState,
  );
  const mirroredToolChunkStateWithPartFallbacks = cloneMirroredToolChunkState(
    input.mirroredToolChunkState,
  );

  for (const chunk of toolFallbackChunksFromParts) {
    recordMirroredToolChunkState(mirroredToolChunkStateWithPartFallbacks, chunk);
  }

  return [
    ...toolFallbackChunksFromParts,
    ...(input.hasIncompleteFinalizedToolParts ? [] : buildMissingFallbackToolChunks(
      input.finalStep,
      mirroredToolChunkStateWithPartFallbacks,
    )),
    ...buildMissingFallbackTextChunks(
      input.persistedMessage.parts,
      input.finalStep,
      fallbackMessageId,
    ),
  ];
}

/** Builds detached fallback chunks. */
export function buildDetachedFallbackChunks(
  input: BuildDetachedFallbackChunksInput,
): ChatUiMessageChunk<MessageMetadata>[] {
  return [
    ...buildMissingFallbackToolChunksFromParts(
      input.fallbackParts,
      input.mirroredToolChunkState,
    ),
    ...(input.hasIncompleteFallbackToolParts ? [] : buildMissingFallbackToolChunks(
      input.finalStep,
      input.mirroredToolChunkState,
    )),
    ...(input.mirroredDurableOutput ? [] : buildMissingFallbackTextChunks(
      [],
      input.finalStep,
      input.capturedMessageId,
    )),
  ];
}
