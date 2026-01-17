/**
 * useChat Hook Utilities
 *
 * Helper functions for the useChat hook.
 */

import type { UIMessage, UIMessagePart } from "./types.ts";

/**
 * Generate client-side ID (fallback when server doesn't provide one)
 */
export function generateClientId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Create assistant message from parts - AI SDK v5 compatible
 */
export function createAssistantMessage(
  messageId: string,
  parts: UIMessagePart[],
): UIMessage {
  return {
    id: messageId || generateClientId("msg"),
    role: "assistant",
    parts,
  };
}
