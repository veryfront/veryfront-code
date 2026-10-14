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

/** Smaller previews tried for skill reference files, which are usually long prose. */
const HISTORICAL_REFERENCE_PREVIEW_BYTES = [2_048, 1_024, 512, 256, 128] as const;

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

  let latestUser = -1;
  let latestToolCall = -1;
  let latestToolResult = -1;
  for (let index = 0; index < input.sourceMessages.length; index++) {
    if (!hasOwn(input.sourceMessages, index)) continue;
    const message = input.sourceMessages[index]!;
    if (message.role === "user") latestUser = index;
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
    }
  }
  // The most recent call and all its results are the active tool turn.
  const protectedToolTurnStart = latestToolCall >= 0 ? latestToolCall : latestToolResult;

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
      if (currentEstimate === null) return projected;
      const storedBefore = input.context.size;
      let createdRef: string | undefined;
      let bestMessages: Message[] | undefined;
      let bestBudget = budget;
      const previewCandidates: readonly (number | undefined)[] = isSkillReferenceToolResult(part)
        ? HISTORICAL_REFERENCE_PREVIEW_BYTES
        : [undefined];
      try {
        for (const previewBytes of previewCandidates) {
          const reference = input.context.discloseReference(
            toolResultDisclosureInput(part),
            previewBytes === undefined ? undefined : { previewBytes },
          );
          if (input.context.size > storedBefore) createdRef = reference.modelResult.ref;
          const parts = slicePrivateArray(modelMessage.parts);
          parts[partIndex] = { ...modelPart, result: reference.modelResult };
          const messages = slicePrivateArray(projected);
          messages[messageIndex] = { ...modelMessage, parts };
          const nextBudget = input.inspect(messages);
          if (
            !nextBudget.outputExceeded && nextBudget.estimatedInputTokens !== null &&
            nextBudget.estimatedInputTokens < bestBudget.estimatedInputTokens!
          ) {
            bestMessages = messages;
            bestBudget = nextBudget;
            if (nextBudget.fits) break;
          }
        }
      } catch (error) {
        if (createdRef) input.context.delete(createdRef);
        if (isToolResultContextCapacityError(error)) continue;
        throw error;
      }
      // A reference can cost more than the inline result once the reader schema
      // is exposed. Release newly retained values that do not improve the
      // assembled estimate, leaving storage for a later useful result.
      if (!bestMessages || bestBudget.estimatedInputTokens! >= currentEstimate) {
        if (createdRef) input.context.delete(createdRef);
        continue;
      }
      projected = bestMessages;
      budget = bestBudget;
      if (budget.fits) return projected;
    }
  }
  return projected;
}
