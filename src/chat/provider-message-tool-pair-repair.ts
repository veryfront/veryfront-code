import {
  copyProviderModelMessageSourceId,
  getProviderModelMessageSourceId,
  isToolCallPart,
  isToolResultPart,
} from "./conversation.ts";
import { hasImmediateToolResult } from "./provider-message-anchor-preservation.ts";
import type {
  ChatAssistantContentPart,
  ChatToolResultPart,
  ProviderModelMessage,
} from "./types.ts";

function createSyntheticToolResult(toolCallId: string, toolName: string): ChatToolResultPart {
  return {
    type: "tool-result",
    toolCallId,
    toolName,
    output: { type: "text", value: "[tool result unavailable]" },
  };
}

/** Repair tool pairs. */
function repairToolPairsWithOptions(
  messages: ProviderModelMessage[],
  options: { preserveUnresolvedProviderCallSourceMessageIds?: readonly string[] } = {},
): ProviderModelMessage[] {
  const result = [...messages];
  let mutated = false;
  const preservedUnresolvedCallSourceIds = new Set(
    options.preserveUnresolvedProviderCallSourceMessageIds ?? [],
  );

  for (let index = 0; index < result.length; index++) {
    const message = result[index];
    if (!message) continue;

    if (message.role !== "assistant" || !Array.isArray(message.content)) {
      continue;
    }

    const inlineResultIds = new Set<string>();
    for (const part of message.content) {
      if (isToolResultPart(part)) {
        inlineResultIds.add(part.toolCallId);
      }
    }

    const nextMessage = result[index + 1];

    const repairedContent: ChatAssistantContentPart[] = [];
    const regularToolCalls: Array<{ id: string; toolName: string }> = [];

    for (const part of message.content) {
      repairedContent.push(part);

      if (!isToolCallPart(part)) {
        continue;
      }

      const toolName = part.toolName ?? "unknown";
      const sourceId = getProviderModelMessageSourceId(message);
      const preserveUnresolvedCall = sourceId !== undefined &&
        preservedUnresolvedCallSourceIds.has(sourceId);

      if (part.providerExecuted) {
        if (
          !inlineResultIds.has(part.toolCallId) &&
          !hasImmediateToolResult(nextMessage, part.toolCallId) &&
          !preserveUnresolvedCall
        ) {
          repairedContent.push(createSyntheticToolResult(part.toolCallId, toolName));
          mutated = true;
        }
        continue;
      }

      if (!inlineResultIds.has(part.toolCallId) && !preserveUnresolvedCall) {
        regularToolCalls.push({ id: part.toolCallId, toolName });
      }
    }

    if (repairedContent.length !== message.content.length) {
      result[index] = copyProviderModelMessageSourceId(message, {
        ...message,
        content: repairedContent,
      });
    }

    if (regularToolCalls.length === 0) {
      continue;
    }

    const unresolvedCalls = regularToolCalls.filter((toolCall) =>
      !hasImmediateToolResult(nextMessage, toolCall.id)
    );
    if (unresolvedCalls.length === 0) {
      continue;
    }

    const movedResults = new Map<string, ChatToolResultPart>();

    if (nextMessage?.role !== "user" && nextMessage?.role !== "system") {
      for (
        let laterIndex = index + 2;
        laterIndex < result.length && movedResults.size < unresolvedCalls.length;
        laterIndex++
      ) {
        const laterMessage = result[laterIndex];
        if (laterMessage?.role === "user" || laterMessage?.role === "system") {
          break;
        }
        if (laterMessage?.role !== "tool" || !Array.isArray(laterMessage.content)) {
          continue;
        }

        let removedFromLater = false;
        const keptLaterContent = laterMessage.content.filter((part) => {
          if (!isToolResultPart(part)) {
            return true;
          }

          if (
            !unresolvedCalls.some((toolCall) => toolCall.id === part.toolCallId) ||
            movedResults.has(part.toolCallId)
          ) {
            return true;
          }

          movedResults.set(part.toolCallId, part);
          removedFromLater = true;
          return false;
        });

        if (!removedFromLater) {
          continue;
        }

        if (keptLaterContent.length === 0) {
          result.splice(laterIndex, 1);
          laterIndex--;
          continue;
        }

        result[laterIndex] = copyProviderModelMessageSourceId(laterMessage, {
          ...laterMessage,
          content: keptLaterContent,
        });
      }
    }

    const repairedResults = unresolvedCalls.map(
      (toolCall) =>
        movedResults.get(toolCall.id) ?? createSyntheticToolResult(toolCall.id, toolCall.toolName),
    );

    if (nextMessage?.role === "tool" && Array.isArray(nextMessage.content)) {
      result[index + 1] = copyProviderModelMessageSourceId(nextMessage, {
        ...nextMessage,
        content: [...repairedResults, ...nextMessage.content],
      });
    } else {
      const toolMessage: ProviderModelMessage = {
        role: "tool",
        content: repairedResults,
      };
      result.splice(index + 1, 0, copyProviderModelMessageSourceId(message, toolMessage));
    }
    mutated = true;
  }

  return mutated ? result : messages;
}

/** Repair tool pairs. */
export function repairToolPairs(messages: ProviderModelMessage[]): ProviderModelMessage[] {
  return repairToolPairsWithOptions(messages);
}

/** Repair tool pairs while retaining unresolved calls backed by replay checkpoints. */
export function repairToolPairsForPreparation(
  messages: ProviderModelMessage[],
  preserveUnresolvedProviderCallSourceMessageIds: readonly string[] | undefined,
): ProviderModelMessage[] {
  return repairToolPairsWithOptions(messages, {
    preserveUnresolvedProviderCallSourceMessageIds,
  });
}
