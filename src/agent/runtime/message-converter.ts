/**
 * Message Converter
 *
 * Converts between AI SDK v5 message format and provider formats.
 */

import {
  getTextFromParts,
  getToolArguments,
  type Message,
  type MessagePart,
  type ToolCallPart,
  type ToolResultPart,
} from "../types.ts";

/**
 * Provider message format (OpenAI-compatible)
 */
export interface ProviderMessage {
  role: string;
  content: string;
  tool_calls?: Array<{
    id: string;
    type: string;
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

/**
 * Convert AI SDK v5 Message to provider format.
 *
 * Handles:
 * - Text content extraction from parts
 * - Tool calls (both tool-${toolName} and legacy tool-call patterns)
 * - Tool results
 *
 * Empty parts array results in empty content string, which is valid for
 * providers (e.g., assistant message with only tool calls, no text).
 */
export function convertMessageToProvider(msg: Message): ProviderMessage {
  const content = getTextFromParts(msg.parts);

  const providerMsg: ProviderMessage = {
    role: msg.role,
    content,
  };

  // Extract tool calls from parts
  // AI SDK v5 uses tool-${toolName} pattern (e.g., "tool-weather")
  // Also support legacy "tool-call" for backwards compatibility
  // Exclude "tool-result" which also starts with "tool-"
  const toolCallParts = msg.parts.filter(
    (p): p is ToolCallPart | (MessagePart & { type: "tool-call" }) =>
      p.type === "tool-call" || (p.type.startsWith("tool-") && p.type !== "tool-result"),
  );

  if (toolCallParts.length > 0) {
    providerMsg.tool_calls = toolCallParts.map((tc) => ({
      id: tc.toolCallId,
      type: "function",
      function: {
        name: tc.toolName,
        // Use type-safe helper to extract args/input (throws if missing)
        arguments: JSON.stringify(getToolArguments(tc as ToolCallPart)),
      },
    }));
  }

  // Extract tool result info from parts
  const toolResultPart = msg.parts.find(
    (p): p is ToolResultPart => p.type === "tool-result",
  );

  if (toolResultPart && msg.role === "tool") {
    providerMsg.tool_call_id = toolResultPart.toolCallId;
    providerMsg.content = JSON.stringify(toolResultPart.result);
  }

  return providerMsg;
}

/**
 * Convert provider message back to AI SDK v5 format
 */
export function convertProviderToMessage(
  providerMsg: ProviderMessage,
  messageId?: string,
): Message {
  const parts: MessagePart[] = [];

  // Add text content if present
  if (providerMsg.content) {
    parts.push({ type: "text", text: providerMsg.content });
  }

  // Add tool calls if present
  if (providerMsg.tool_calls) {
    for (const tc of providerMsg.tool_calls) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(tc.function.arguments);
      } catch {
        // Keep empty args on parse failure
      }

      parts.push({
        type: `tool-${tc.function.name}`,
        toolCallId: tc.id,
        toolName: tc.function.name,
        args,
      });
    }
  }

  return {
    id: messageId || `msg_${Date.now()}`,
    role: providerMsg.role as Message["role"],
    parts,
    timestamp: Date.now(),
  };
}
