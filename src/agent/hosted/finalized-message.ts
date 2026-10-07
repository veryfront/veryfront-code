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
    const completed = finalStepFallbackParts.find((fallback) =>
      isToolUiPart(fallback) && fallback.toolCallId === part.toolCallId &&
      fallback.state === "output-available"
    );
    return completed && isToolUiPart(completed) && completed.state === "output-available"
      ? { ...part, state: "output-available" as const, output: completed.output }
      : part;
  });
  const unmatchedPersistedReasoningParts = persistedMessage.parts.filter(
    (part): part is ReasoningPart => part.type === "reasoning" && isSubstantiveReasoningPart(part),
  );
  const relocatedParts = new Set<ChatUiMessage["parts"][number]>();
  const unmatchedTextParts = completedParts.filter((part) => part.type === "text");
  let hasPlacedMissingText = false;
  const missingFallbackParts = finalStepFallbackParts.flatMap((fallbackPart) => {
    if (fallbackPart.type === "text") {
      hasPlacedMissingText = true;
      const exactIndex = unmatchedTextParts.findIndex((part) =>
        part.text.trim() === fallbackPart.text.trim()
      );
      if (!input.isAborted && exactIndex >= 0) {
        const [matched] = unmatchedTextParts.splice(exactIndex, 1);
        relocatedParts.add(matched!);
        return [matched!];
      }
      const missing = appendMissingFallbackTextPart(unmatchedTextParts, { text: fallbackPart.text })
        .slice(unmatchedTextParts.length);
      const hasPrefix = unmatchedTextParts.length > 0 && ["\n\n", "\n", " ", ""]
        .map((separator) => unmatchedTextParts.map((part) => part.text.trim()).join(separator))
        .some((prefix) => prefix.length > 0 && fallbackPart.text.startsWith(prefix));
      if (!input.isAborted && hasPrefix) {
        const matched = unmatchedTextParts.splice(0);
        matched.forEach((part) => relocatedParts.add(part));
        return [...matched, ...missing];
      }
      return missing;
    }
    if (fallbackPart.type === "reasoning") {
      const matchingIndex = unmatchedPersistedReasoningParts.findIndex((part) =>
        hasSameReasoningContent(part, fallbackPart)
      );
      if (matchingIndex < 0) {
        return [fallbackPart];
      }
      const [matched] = unmatchedPersistedReasoningParts.splice(matchingIndex, 1);
      if (input.isAborted) return [];
      relocatedParts.add(matched!);
      return [matched!];
    }
    if (!isToolUiPart(fallbackPart)) return [];
    const persisted = completedParts.find((part) =>
      isToolUiPart(part) && part.toolCallId === fallbackPart.toolCallId
    );
    if (persisted && !input.isAborted) relocatedParts.add(persisted);
    return persisted ? input.isAborted ? [] : [persisted] : [fallbackPart];
  });
  const retainedPrefix: ChatUiMessage["parts"] = [];
  const reconciledParts = [...missingFallbackParts];
  completedParts.forEach((part, index) => {
    if (relocatedParts.has(part)) return;
    const anchor = completedParts.slice(0, index).findLast((previous) =>
      reconciledParts.includes(previous)
    );
    if (anchor) reconciledParts.splice(reconciledParts.indexOf(anchor) + 1, 0, part);
    else retainedPrefix.push(part);
  });
  const fallbackParts = persistedMessage.parts.length === 0
    ? finalStepFallbackParts
    : hasPlacedMissingText
    ? [...retainedPrefix, ...reconciledParts]
    : appendMissingFallbackTextPart([...retainedPrefix, ...reconciledParts], input.finalStep);
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

  const appendedFallbackParts = input.sanitizedFinalizedMessage.parts.filter((part) =>
    !input.persistedMessage.parts.includes(part)
  );
  const hasOrderedFallbackContent = appendedFallbackParts.some((part) =>
    part.type === "text" || part.type === "reasoning"
  );
  if (hasOrderedFallbackContent) {
    const orderedFallbackChunks = buildFallbackUiMessageChunksFromParts(
      appendedFallbackParts,
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
