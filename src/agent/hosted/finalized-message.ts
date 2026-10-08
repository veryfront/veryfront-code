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
  /** Selected recovery parts in provider final-step order, never persisted in the message. */
  recoveredFallbackParts?: ChatUiMessage["parts"];
  hasIncompleteFinalizedToolParts: boolean;
}

/** State for detached fallback message. */
export interface DetachedFallbackMessageState {
  finalizedFallbackMessage: ChatUiMessage;
  hasIncompleteFallbackToolParts: boolean;
}

/** Input payload for build finalized message fallback chunks. */
export interface BuildFinalizedMessageFallbackChunksInput {
  isAborted: boolean;
  persistedMessage: ChatUiMessage;
  sanitizedFinalizedMessage: ChatUiMessage;
  finalStep: unknown;
  mirroredToolChunkState: MirroredToolChunkState;
  capturedMessageId: string | null;
  hasIncompleteFinalizedToolParts: boolean;
  recoveredFallbackParts?: readonly ChatUiMessage["parts"][number][];
}

/** Input payload for build detached fallback chunks. */
export interface BuildDetachedFallbackChunksInput {
  fallbackParts: ChatUiMessage["parts"];
  mirroredParts?: readonly ChatUiMessage["parts"][number][];
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
  let persistedTextCursor = 0;
  const consumedTextIndexes = new Set<number>();
  const fallbackTextCount = finalStepFallbackParts.filter((part) => part.type === "text").length;
  const recoveredFallbackParts: ChatUiMessage["parts"] = [];
  let hasPlacedMissingText = false;
  const missingFallbackParts = finalStepFallbackParts.flatMap((fallbackPart) => {
    if (fallbackPart.type === "text") {
      hasPlacedMissingText = true;
      let matchingStart = -1;
      let matchedCount = 0;
      let matchedIndexes: number[] = [];
      let matchedLength = 0;
      for (let start = 0; start < persistedTextParts.length; start++) {
        if (consumedTextIndexes.has(start)) continue;
        const availableIndexes = persistedTextParts.map((_, index) => index)
          .filter((index) => index >= start && !consumedTextIndexes.has(index));
        for (let count = 1; count <= availableIndexes.length; count++) {
          const indexes = availableIndexes.slice(0, count);
          const texts = indexes.map((index) => persistedTextParts[index]!.text);
          const prefixLength = Math.max(...["\n\n", "\n", " ", ""].map((separator) => {
            const prefix = texts.join(separator).trim();
            return fallbackPart.text.startsWith(prefix) ? prefix.length : 0;
          }));
          if (prefixLength === 0) break;
          // Recovery is append-only: an exact completed block may sit before a
          // previously appended missing block. Reuse it, never a backwards prefix.
          if (start < persistedTextCursor && prefixLength !== fallbackPart.text.trim().length) {
            continue;
          }
          // Multiple fallback blocks consume prefixes in order. A single block
          // still recovers the latest partial repetition from the final step.
          if (
            matchingStart < 0 ||
            (fallbackTextCount === 1
              ? start + count > matchingStart + matchedCount ||
                (start + count === matchingStart + matchedCount && prefixLength > matchedLength)
              : start < matchingStart ||
                (start === matchingStart && prefixLength > matchedLength))
          ) {
            matchingStart = start;
            matchedCount = count;
            matchedIndexes = indexes;
            matchedLength = prefixLength;
          }
        }
      }
      const matchedParts = matchingStart < 0
        ? []
        : matchedIndexes.map((index) => persistedTextParts[index]!);
      if (matchedCount > 0) {
        for (const index of matchedIndexes) consumedTextIndexes.add(index);
        persistedTextCursor = Math.max(persistedTextCursor, matchedIndexes.at(-1)! + 1);
      }
      const missingTextParts = appendMissingFallbackTextPart(matchedParts, {
        text: fallbackPart.text,
      })
        .slice(matchedParts.length);
      recoveredFallbackParts.push(...missingTextParts);
      return missingTextParts;
    }
    if (fallbackPart.type === "reasoning") {
      const matchingIndex = unmatchedPersistedReasoningParts.findIndex((part) =>
        hasSameReasoningContent(part, fallbackPart)
      );
      if (matchingIndex < 0) {
        recoveredFallbackParts.push(fallbackPart);
        return [fallbackPart];
      }
      unmatchedPersistedReasoningParts.splice(matchingIndex, 1);
      return [];
    }
    if (isToolUiPart(fallbackPart)) {
      recoveredFallbackParts.push(
        completedParts.find((part) =>
          isToolUiPart(part) && part.toolCallId === fallbackPart.toolCallId
        ) ?? fallbackPart,
      );
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

  const orderedRecoveredParts = persistedMessage.parts.length === 0
    ? sanitizedFinalizedMessage.parts
    : recoveredFallbackParts.map((part) =>
      isToolUiPart(part)
        ? sanitizedFinalizedMessage.parts.find((candidate) =>
          isToolUiPart(candidate) && candidate.toolCallId === part.toolCallId
        ) ?? part
        : part
    ).filter((part) => !persistedMessage.parts.includes(part));
  return {
    persistedMessage,
    sanitizedFinalizedMessage,
    recoveredFallbackParts: orderedRecoveredParts,
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

/** Reserve recovered reasoning IDs against actual previously mirrored content. */
function buildOrderedFallbackChunks(
  parts: readonly ChatUiMessage["parts"][number][],
  messageId: string,
  state: MirroredToolChunkState,
): ChatUiMessageChunk<MessageMetadata>[] {
  const usedIds = new Set(state.reasoningContentIds);
  const replacements = new Map<string, string>();
  return buildFallbackUiMessageChunksFromParts(parts, messageId, state).map((chunk) => {
    if (
      chunk.type !== "reasoning-start" && chunk.type !== "reasoning-delta" &&
      chunk.type !== "reasoning-end"
    ) return chunk;
    let id = replacements.get(chunk.id);
    if (id === undefined) {
      id = chunk.id;
      let suffix = 2;
      while (usedIds.has(id)) id = `${chunk.id}:recovered:${suffix++}`;
      replacements.set(chunk.id, id);
      usedIds.add(id);
    }
    return id === chunk.id ? chunk : { ...chunk, id };
  });
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
    !input.persistedMessage.parts.includes(part)
  );
  // Select from reconciliation's actual recovery positions, not overlapping
  // text suffixes that may also occur in an already streamed earlier block.
  const recoveryOrder = input.recoveredFallbackParts ?? buildFinalizedMessageState({
    responseMessage: input.persistedMessage,
    isAborted: input.isAborted,
    finalStep: input.finalStep,
    incompleteToolCallsPartErrorText: "",
  }).recoveredFallbackParts ?? [];
  const remainingFallbackParts = [...appendedFallbackParts];
  const orderedFallbackParts = recoveryOrder.flatMap((recovered) => {
    const index = remainingFallbackParts.findIndex((part) => {
      if (isToolUiPart(recovered) && isToolUiPart(part)) {
        return part.toolCallId === recovered.toolCallId;
      }
      if (recovered.type === "reasoning" && part.type === "reasoning") {
        return hasSameReasoningContent(part, recovered);
      }
      return recovered.type === "text" && part.type === "text" && recovered.text === part.text;
    });
    return index < 0 ? [] : remainingFallbackParts.splice(index, 1);
  });
  orderedFallbackParts.push(...remainingFallbackParts);
  const hasOrderedFallbackContent = appendedFallbackParts.some((part) =>
    part.type === "text" || part.type === "reasoning"
  );
  if (hasOrderedFallbackContent) {
    const orderedFallbackChunks = buildOrderedFallbackChunks(
      orderedFallbackParts,
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
  ];
}

/** Builds detached fallback chunks. */
export function buildDetachedFallbackChunks(
  input: BuildDetachedFallbackChunksInput,
): ChatUiMessageChunk<MessageMetadata>[] {
  const orderedParts = input.fallbackParts.filter((part) => {
    if (part.type === "reasoning") {
      return input.mirroredParts !== undefined
        ? !input.mirroredParts.includes(part)
        : !input.mirroredDurableOutput;
    }
    return part.type !== "text" || !input.mirroredDurableOutput;
  });
  const primaryChunks = buildOrderedFallbackChunks(
    orderedParts,
    input.capturedMessageId,
    input.mirroredToolChunkState,
  );
  const reconciledToolState = cloneMirroredToolChunkState(input.mirroredToolChunkState);
  for (const chunk of primaryChunks) recordMirroredToolChunkState(reconciledToolState, chunk);

  return [
    ...primaryChunks,
    ...(input.hasIncompleteFallbackToolParts ? [] : buildMissingFallbackToolChunks(
      input.finalStep,
      reconciledToolState,
    )),
    ...(input.mirroredDurableOutput || orderedParts.some((part) => part.type === "text")
      ? []
      : buildMissingFallbackTextChunks([], input.finalStep, input.capturedMessageId)),
  ];
}
