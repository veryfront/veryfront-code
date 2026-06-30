import type { ChatMessage, ChatMessagePart } from "./types.ts";

export function generateClientId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createAssistantMessage(
  messageId: string,
  parts: ChatMessagePart[],
  metadata?: ChatMessage["metadata"],
): ChatMessage {
  return {
    id: messageId || generateClientId("msg"),
    role: "assistant",
    parts,
    ...(metadata && Object.keys(metadata).length > 0 ? { metadata } : {}),
  };
}
