import type { ChatMessage, ChatMessagePart } from "./types.ts";

export function generateClientId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createAssistantMessage(
  messageId: string,
  parts: ChatMessagePart[],
  metadata?: ChatMessage["metadata"],
): ChatMessage {
  // Prefer a server-supplied timestamp (from message metadata); otherwise stamp
  // the client clock so the message header always has a time to render.
  const metaCreatedAt = typeof metadata?.createdAt === "string" ? metadata.createdAt : undefined;
  return {
    id: messageId || generateClientId("msg"),
    role: "assistant",
    parts,
    createdAt: metaCreatedAt ?? new Date().toISOString(),
    ...(metadata && Object.keys(metadata).length > 0 ? { metadata } : {}),
  };
}
