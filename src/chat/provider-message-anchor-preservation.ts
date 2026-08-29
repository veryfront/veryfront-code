import {
  getProviderModelMessageSourceId,
  isToolResultPart,
  withProviderModelMessageSourceId,
} from "./conversation.ts";
import type { ChatUiMessage, ProviderModelMessage } from "./types.ts";

export type ProviderMessageSanitizationOptions = {
  preserveEmptyAssistantSourceMessageIds?: readonly string[];
};

export function shouldPreserveEmptyAssistantMessage(
  message: ProviderModelMessage,
  options: ProviderMessageSanitizationOptions,
): boolean {
  if (message.role !== "assistant") return false;
  const sourceId = getProviderModelMessageSourceId(message);
  return sourceId !== undefined &&
    options.preserveEmptyAssistantSourceMessageIds?.includes(sourceId) === true;
}

/** Preserve provider replay anchors whose public assistant content was empty. */
export function preserveEmptyAssistantAnchors(
  providerMessages: ProviderModelMessage[],
  sourceMessages: readonly ChatUiMessage[],
  preserveSourceMessageIds: readonly string[] | undefined,
): ProviderModelMessage[] {
  if (preserveSourceMessageIds === undefined || preserveSourceMessageIds.length === 0) {
    return providerMessages;
  }

  const preservedIds = new Set(preserveSourceMessageIds);
  const messagesBySourceId = new Map<string, ProviderModelMessage[]>();
  for (const message of providerMessages) {
    const sourceId = getProviderModelMessageSourceId(message);
    if (sourceId === undefined) continue;
    const messagesForSource = messagesBySourceId.get(sourceId) ?? [];
    messagesForSource.push(message);
    messagesBySourceId.set(sourceId, messagesForSource);
  }

  const result: ProviderModelMessage[] = [];
  const emittedSourceIds = new Set<string>();
  for (const sourceMessage of sourceMessages) {
    const sourceId = sourceMessage.id;
    const existingMessages = messagesBySourceId.get(sourceId);
    if (existingMessages) {
      result.push(...existingMessages);
      emittedSourceIds.add(sourceId);
    } else if (
      sourceMessage.role === "assistant" &&
      sourceMessage.parts.length === 0 &&
      preservedIds.has(sourceId)
    ) {
      result.push(withProviderModelMessageSourceId({ role: "assistant", content: [] }, sourceId));
      emittedSourceIds.add(sourceId);
    }
  }

  for (const message of providerMessages) {
    const sourceId = getProviderModelMessageSourceId(message);
    if (sourceId === undefined || !emittedSourceIds.has(sourceId)) result.push(message);
  }

  return result;
}

export function hasImmediateToolResult(
  message: ProviderModelMessage | undefined,
  toolCallId: string,
): boolean {
  return message?.role === "tool" && Array.isArray(message.content) &&
    message.content.some((part) => isToolResultPart(part) && part.toolCallId === toolCallId);
}
