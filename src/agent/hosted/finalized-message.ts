import {
  hasIncompleteToolParts,
  isToolUiPart,
  markIncompleteToolPartsAsErrored,
  markIncompleteToolPartsAsStopped,
} from "../../chat/conversation.ts";
import {
  appendMissingFallbackTextPart,
  buildFallbackUiMessageChunksFromParts,
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

type ReasoningPart = Extract<ChatUiMessage["parts"][number], { type: "reasoning" }>;

function isSubstantiveReasoningPart(part: ReasoningPart): boolean {
  return part.text.length > 0 || (part.signature?.length ?? 0) > 0 ||
    (part.redactedData?.length ?? 0) > 0;
}

function hasSameReasoningContent(left: ReasoningPart, right: ReasoningPart): boolean {
  return left.text.trim() === right.text.trim() && left.signature === right.signature &&
    left.redactedData === right.redactedData;
}

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
  isAborted?: boolean;
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
  const completedParts = persistedMessage.parts.map((part) => {
    if (
      input.isAborted || !isToolUiPart(part) ||
      !["pending", "input-streaming", "input-available", "approval-requested", "approval-responded"]
        .includes(part.state)
    ) {
      return part;
    }
    const partialInput = part.state === "input-streaming" || part.state === "pending";
    const completed = finalStepFallbackParts.find((fallback) =>
      isToolUiPart(fallback) && fallback.toolCallId === part.toolCallId &&
      (fallback.state === "output-available" ||
        (fallback.state === "input-available" && fallback.providerExecuted === true &&
          part.providerExecuted !== false))
    );
    if (!completed || !isToolUiPart(completed)) return part;
    if (completed.state === "input-available" && completed.providerExecuted === true) {
      return {
        ...part,
        input: partialInput ? completed.input : part.input,
        state: "input-available" as const,
        providerExecuted: true,
      };
    }
    return completed.state === "output-available"
      ? {
        ...part,
        input: partialInput ? completed.input : part.input,
        state: "output-available" as const,
        output: completed.output,
        ...(part.providerExecuted === undefined && completed.providerExecuted !== undefined
          ? { providerExecuted: completed.providerExecuted }
          : {}),
      }
      : part;
  });
  const finalStepStart = persistedMessage.parts.findLastIndex((part) => part.type === "step-start");
  const persistedFinalStepParts = persistedMessage.parts.slice(finalStepStart + 1);
  const unmatchedPersistedReasoningParts = persistedFinalStepParts.filter(
    (part): part is ReasoningPart => part.type === "reasoning" && isSubstantiveReasoningPart(part),
  );
  const persistedTextParts = persistedFinalStepParts.filter((part) => part.type === "text")
    .filter((part) => part.text.trim().length > 0);
  let textCursor = 0;
  let hasPlacedMissingText = false;
  const missingFallbackParts = finalStepFallbackParts.flatMap((fallbackPart) => {
    if (fallbackPart.type === "text") {
      hasPlacedMissingText = true;
      while (
        textCursor < persistedTextParts.length &&
        !fallbackPart.text.startsWith(persistedTextParts[textCursor]!.text.trim())
      ) {
        textCursor++;
      }
      const remainingParts = persistedTextParts.slice(textCursor);
      let matchedCount = 0;
      for (let count = 1; count <= remainingParts.length; count++) {
        const texts = remainingParts.slice(0, count).map((part) => part.text);
        const matchesPrefix = ["\n\n", "\n", " ", ""].some((separator) => {
          const prefix = texts.join(separator).trim();
          return prefix.length > 0 && fallbackPart.text.startsWith(prefix);
        });
        if (!matchesPrefix) break;
        matchedCount = count;
      }
      const matchedParts = remainingParts.slice(0, matchedCount);
      textCursor += matchedCount;
      return appendMissingFallbackTextPart(matchedParts, { text: fallbackPart.text })
        .slice(matchedParts.length);
    }
    if (fallbackPart.type === "reasoning") {
      const matchingIndex = unmatchedPersistedReasoningParts.findIndex((part) =>
        hasSameReasoningContent(part, fallbackPart)
      );
      if (matchingIndex < 0) return [fallbackPart];
      unmatchedPersistedReasoningParts.splice(matchingIndex, 1);
      return [];
    }
    return !input.isAborted && isToolUiPart(fallbackPart) &&
        !persistedMessage.parts.some((part) =>
          isToolUiPart(part) && part.toolCallId === fallbackPart.toolCallId
        )
      ? [fallbackPart]
      : [];
  });
  // Durable content is append-only; recovery cannot move an already emitted part.
  const fallbackParts = persistedMessage.parts.length === 0
    ? finalStepFallbackParts
    : hasPlacedMissingText
    ? [...completedParts, ...missingFallbackParts]
    : appendMissingFallbackTextPart([...completedParts, ...missingFallbackParts], input.finalStep);
  const finalizedMessage = fallbackParts.length !== persistedMessage.parts.length ||
      fallbackParts.some((part, index) => part !== persistedMessage.parts[index])
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

  const reconciledToolChunkState = cloneMirroredToolChunkState(input.mirroredToolChunkState);
  for (const part of input.sanitizedFinalizedMessage.parts) {
    if (!isToolUiPart(part) || part.state !== "input-available" || part.providerExecuted !== true) {
      continue;
    }
    const persisted = input.persistedMessage.parts.find((candidate) =>
      isToolUiPart(candidate) && candidate.toolCallId === part.toolCallId
    );
    if (persisted && isToolUiPart(persisted) && persisted.providerExecuted === undefined) {
      reconciledToolChunkState.inputAvailableToolCallIds.delete(part.toolCallId);
    }
  }

  const appendedFallbackParts = input.sanitizedFinalizedMessage.parts.filter((part) =>
    !input.persistedMessage.parts.includes(part) &&
    (!isToolUiPart(part) ||
      !input.persistedMessage.parts.some((persisted) =>
        isToolUiPart(persisted) && persisted.toolCallId === part.toolCallId
      ))
  );
  const hasOrderedFallbackContent = appendedFallbackParts.some((part) =>
    part.type === "text" || part.type === "reasoning"
  );
  if (hasOrderedFallbackContent) {
    const orderedFallbackChunks = buildFallbackUiMessageChunksFromParts(
      appendedFallbackParts,
      fallbackMessageId,
      reconciledToolChunkState,
    );
    const mirroredToolChunkStateWithOrderedFallbacks = cloneMirroredToolChunkState(
      reconciledToolChunkState,
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
    reconciledToolChunkState,
  );
  const mirroredToolChunkStateWithPartFallbacks = cloneMirroredToolChunkState(
    reconciledToolChunkState,
  );

  for (const chunk of toolFallbackChunksFromParts) {
    recordMirroredToolChunkState(mirroredToolChunkStateWithPartFallbacks, chunk);
  }

  return [
    ...toolFallbackChunksFromParts,
    ...(input.isAborted || input.hasIncompleteFinalizedToolParts
      ? []
      : buildMissingFallbackToolChunks(
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
  const toolChunks = buildMissingFallbackToolChunksFromParts(
    input.fallbackParts,
    input.mirroredToolChunkState,
  );
  const reconciledToolState = cloneMirroredToolChunkState(input.mirroredToolChunkState);
  for (const chunk of toolChunks) recordMirroredToolChunkState(reconciledToolState, chunk);

  return [
    ...toolChunks,
    ...(input.hasIncompleteFallbackToolParts ? [] : buildMissingFallbackToolChunks(
      input.finalStep,
      reconciledToolState,
    )),
    ...(input.mirroredDurableOutput ? [] : buildMissingFallbackTextChunks(
      [],
      input.finalStep,
      input.capturedMessageId,
    )),
  ];
}
