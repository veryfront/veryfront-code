import { readToolResultOwnDataProperty } from "#veryfront/tool/result.ts";
import { slicePrivateArray, somePrivateArray } from "#veryfront/security/private-array.ts";
import { privateTextStartsWith } from "#veryfront/security/private-text.ts";
import type { Message, ToolResultPart } from "../types.ts";
import { isToolResultContextCapacityError, type ToolResultContext } from "./tool-result-context.ts";
import {
  isSkillReferenceToolResult,
  toolResultDisclosureInput,
} from "./tool-result-context-messages.ts";

const hasOwn = Object.hasOwn;

/** Results that carry discovery or instructions the model must keep verbatim. */
const PROTECTED_TOOL_NAMES = new Set([
  "tool_search",
  "get_tool_result",
  "load_skill",
  "veryfront__load_skill",
]);

function isProtectedToolResult(part: ToolResultPart): boolean {
  return PROTECTED_TOOL_NAMES.has(part.toolName) && !isSkillReferenceToolResult(part);
}

/** Smaller previews tried when a default historical preview still does not fit. */
const HISTORICAL_REFERENCE_PREVIEW_BYTES = [2_048, 1_024, 512, 256, 128] as const;

/** Skill reference files are usually long prose, so they start below the default. */
const SKILL_REFERENCE_PREVIEW_CANDIDATES: readonly (number | undefined)[] =
  HISTORICAL_REFERENCE_PREVIEW_BYTES;
/** Ordinary results keep the default preview when it fits, then shrink it. */
const ORDINARY_PREVIEW_CANDIDATES: readonly (number | undefined)[] = [
  undefined,
  ...HISTORICAL_REFERENCE_PREVIEW_BYTES,
];

/** Budget measurement for one candidate set of model messages. */
export type ToolResultProjectionBudget = {
  readonly fits: boolean;
  readonly outputExceeded: boolean;
  readonly estimatedInputTokens: number | null;
};

/**
 * Replace old ordinary tool results with retrievable references, oldest first,
 * until the assembled request fits. Only this model request changes: source
 * history is untouched. The latest user message and the active tool turn stay
 * inline.
 */
export function projectHistoricalToolResultsForBudget(input: {
  sourceMessages: readonly Message[];
  modelMessages: readonly Message[];
  context: ToolResultContext;
  /** Measures the complete request, including a newly exposed reader schema. */
  inspect: (messages: Message[]) => ToolResultProjectionBudget;
}): Message[] {
  let projected = slicePrivateArray(input.modelMessages);
  let budget = input.inspect(projected);
  if (budget.fits || budget.outputExceeded || budget.estimatedInputTokens === null) {
    return projected;
  }

  let bestProjected = projected;
  let bestOverallBudget = budget;
  const createdRefs: string[] = [];
  let bestRefCount = 0;
  const discardTentativeReferences = () => {
    while (createdRefs.length > bestRefCount) input.context.delete(createdRefs.pop()!);
    projected = bestProjected;
    budget = bestOverallBudget;
  };
  const finishProjection = () => {
    discardTentativeReferences();
    return bestProjected;
  };

  let latestUser = -1;
  let latestToolCall = -1;
  let latestToolResult = -1;
  let firstToolResultAfterLatestUser = -1;
  for (let index = 0; index < input.sourceMessages.length; index++) {
    if (!hasOwn(input.sourceMessages, index)) continue;
    const message = input.sourceMessages[index]!;
    if (message.role === "user") {
      latestUser = index;
      firstToolResultAfterLatestUser = -1;
    }
    if (
      somePrivateArray(
        message.parts,
        (part) => privateTextStartsWith(part.type, "tool-") && part.type !== "tool-result",
      )
    ) {
      latestToolCall = index;
    }
    if (somePrivateArray(message.parts, (part) => part.type === "tool-result")) {
      latestToolResult = index;
      if (firstToolResultAfterLatestUser < 0) firstToolResultAfterLatestUser = index;
    }
  }
  // The most recent call and all its results are the active tool turn. A turn
  // completed before the latest user message is history and can be projected.
  const latestToolTurnStart = latestToolCall >= 0 ? latestToolCall : latestToolResult;
  // A resumed result delivered after the latest user message answers a call
  // stored before it; the model has not seen it yet, so it stays active.
  const protectedToolTurnStart = latestToolTurnStart > latestUser
    ? latestToolTurnStart
    : firstToolResultAfterLatestUser >= 0
    ? firstToolResultAfterLatestUser
    : input.sourceMessages.length;

  for (let messageIndex = 0; messageIndex < input.sourceMessages.length; messageIndex++) {
    if (
      !hasOwn(input.sourceMessages, messageIndex) || messageIndex === latestUser ||
      messageIndex >= protectedToolTurnStart
    ) continue;
    const sourceMessage = input.sourceMessages[messageIndex]!;
    for (let partIndex = 0; partIndex < sourceMessage.parts.length; partIndex++) {
      if (!hasOwn(sourceMessage.parts, partIndex)) continue;
      const modelMessage = projected[messageIndex];
      const part = sourceMessage.parts[partIndex]!;
      if (!modelMessage || part.type !== "tool-result" || !("result" in part)) continue;
      if (!hasOwn(modelMessage.parts, partIndex)) continue;
      const modelPart = modelMessage.parts[partIndex] as ToolResultPart;
      // Existing exact references can use a smaller preview. Preview-only or
      // unrelated model projections must never become retrievable references.
      if (modelPart.result !== part.result) {
        const ref = readToolResultOwnDataProperty(modelPart.result, "ref");
        if (
          readToolResultOwnDataProperty(modelPart.result, "type") !== "tool_result_reference" ||
          typeof ref !== "string" || input.context.getOriginalResult(ref) !== part.result
        ) continue;
      }
      if (isProtectedToolResult(part)) continue;
      const currentEstimate = budget.estimatedInputTokens;
      if (currentEstimate === null) return finishProjection();
      const storedBefore = input.context.size;
      let createdRef: string | undefined;
      let bestMessages: Message[] | undefined;
      let bestCandidateBudget = budget;
      let budgetWithReader: ToolResultProjectionBudget | undefined;
      const previewCandidates = isSkillReferenceToolResult(part)
        ? SKILL_REFERENCE_PREVIEW_CANDIDATES
        : ORDINARY_PREVIEW_CANDIDATES;
      try {
        for (const previewBytes of previewCandidates) {
          const reference = input.context.discloseReference(
            toolResultDisclosureInput(part),
            previewBytes === undefined ? undefined : { previewBytes },
          );
          if (input.context.size > storedBefore) createdRef = reference.modelResult.ref;
          // Measure the inline request with the same reader exposure, separating
          // this result's savings from the helper schema's one-time overhead.
          budgetWithReader ??= input.inspect(projected);
          const parts = slicePrivateArray(modelMessage.parts);
          parts[partIndex] = { ...modelPart, result: reference.modelResult };
          const messages = slicePrivateArray(projected);
          messages[messageIndex] = { ...modelMessage, parts };
          const nextBudget = input.inspect(messages);
          if (
            !nextBudget.outputExceeded && nextBudget.estimatedInputTokens !== null &&
            !budgetWithReader.outputExceeded && budgetWithReader.estimatedInputTokens !== null &&
            (nextBudget.fits ||
              nextBudget.estimatedInputTokens < budgetWithReader.estimatedInputTokens) &&
            (!bestMessages || nextBudget.fits ||
              nextBudget.estimatedInputTokens < bestCandidateBudget.estimatedInputTokens!)
          ) {
            bestMessages = messages;
            bestCandidateBudget = nextBudget;
            if (nextBudget.fits) break;
          }
        }
      } catch (error) {
        if (createdRef) input.context.delete(createdRef);
        if (isToolResultContextCapacityError(error)) {
          if (createdRefs.length > bestRefCount) {
            // An unamortized batch must not occupy the last slot and prevent
            // a later, larger result from paying the reader cost by itself.
            discardTentativeReferences();
            partIndex--;
          }
          continue;
        }
        for (const ref of createdRefs) input.context.delete(ref);
        throw error;
      }
      if (!bestMessages) {
        if (createdRef) input.context.delete(createdRef);
        continue;
      }
      if (createdRef) createdRefs.push(createdRef);
      projected = bestMessages;
      budget = bestCandidateBudget;
      // Several individually useful references may jointly amortize the reader
      // schema. Keep them tentative until their combined estimate improves.
      if (budget.fits || budget.estimatedInputTokens! < bestOverallBudget.estimatedInputTokens!) {
        bestProjected = projected;
        bestOverallBudget = budget;
        bestRefCount = createdRefs.length;
      }
      if (budget.fits) return finishProjection();
    }
  }
  return finishProjection();
}
