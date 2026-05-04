import {
  hasIncompleteToolParts,
  markIncompleteToolPartsAsErrored,
  markIncompleteToolPartsAsStopped,
} from "../chat/conversation.ts";
import {
  appendMissingFallbackTextPart,
  buildFallbackUiMessageParts,
  buildMissingFallbackTextChunks,
  buildMissingFallbackToolChunks,
  buildMissingFallbackToolChunksFromParts,
} from "../chat/final-step-fallback.ts";
import type { ChatUiMessage, ChatUiMessageChunk, MessageMetadata } from "../chat/types.ts";
import {
  cloneMirroredToolChunkState,
  type MirroredToolChunkState,
  recordMirroredToolChunkState,
} from "./mirrored-tool-chunk-state.ts";

export interface BuildFinalizedMessageStateInput {
  responseMessage: ChatUiMessage;
  isAborted: boolean;
  finalStep: unknown;
  incompleteToolCallsPartErrorText: string;
}

export interface BuildDetachedFallbackMessageInput {
  capturedMessageId: string | null;
  finalStep: unknown;
  isAborted: boolean;
  incompleteToolCallsPartErrorText: string;
}

export interface FinalizedMessageState {
  persistedMessage: ChatUiMessage;
  sanitizedFinalizedMessage: ChatUiMessage;
  hasIncompleteFinalizedToolParts: boolean;
}

export interface DetachedFallbackMessageState {
  finalizedFallbackMessage: ChatUiMessage;
  hasIncompleteFallbackToolParts: boolean;
}

export interface BuildFinalizedMessageFallbackChunksInput {
  persistedMessage: ChatUiMessage;
  sanitizedFinalizedMessage: ChatUiMessage;
  finalStep: unknown;
  mirroredToolChunkState: MirroredToolChunkState;
  capturedMessageId: string | null;
  hasIncompleteFinalizedToolParts: boolean;
}

export interface BuildDetachedFallbackChunksInput {
  fallbackParts: ChatUiMessage["parts"];
  finalStep: unknown;
  mirroredToolChunkState: MirroredToolChunkState;
  mirroredDurableOutput: boolean;
  capturedMessageId: string;
  hasIncompleteFallbackToolParts: boolean;
}

export function buildFinalizedMessageState(
  input: BuildFinalizedMessageStateInput,
): FinalizedMessageState {
  const persistedMessage = input.isAborted
    ? markIncompleteToolPartsAsStopped(input.responseMessage)
    : input.responseMessage;
  const fallbackParts = persistedMessage.parts.length === 0
    ? buildFallbackUiMessageParts(input.finalStep)
    : appendMissingFallbackTextPart(persistedMessage.parts, input.finalStep);
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

export function buildFinalizedMessageFallbackChunks(
  input: BuildFinalizedMessageFallbackChunksInput,
): ChatUiMessageChunk<MessageMetadata>[] {
  const fallbackMessageId = input.sanitizedFinalizedMessage.id ||
    input.capturedMessageId;
  if (!fallbackMessageId) {
    return [];
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
