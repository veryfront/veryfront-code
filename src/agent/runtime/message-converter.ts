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
  const providerMsg: ProviderMessage = {
    role: msg.role,
    content: getTextFromParts(msg.parts),
  };

  const toolResultPart = msg.parts.find(
    (p): p is ToolResultPart => p.type === "tool-result",
  );

  if (toolResultPart && msg.role === "tool") {
    return {
      ...providerMsg,
      tool_call_id: toolResultPart.toolCallId,
      content: JSON.stringify(toolResultPart.result),
    };
  }

  const toolCallParts = msg.parts.filter(
    (p): p is ToolCallPart | (MessagePart & { type: "tool-call" }) =>
      p.type === "tool-call" || (p.type.startsWith("tool-") && p.type !== "tool-result"),
  );

  if (!toolCallParts.length) return providerMsg;

  return {
    ...providerMsg,
    tool_calls: toolCallParts.map((tc) => ({
      id: tc.toolCallId,
      type: "function",
      function: {
        name: tc.toolName,
        arguments: JSON.stringify(getToolArguments(tc as ToolCallPart)),
      },
    })),
  };
}

/**
 * Convert provider message back to AI SDK v5 format
 */
export function convertProviderToMessage(
  providerMsg: ProviderMessage,
  messageId?: string,
): Message {
  if (typeof messageId === "string" && messageId.trim().length === 0) {
    throw new Error("Message id cannot be empty.");
  }

  const parts: MessagePart[] = [];

  if (providerMsg.content) {
    parts.push({ type: "text", text: providerMsg.content });
  }

  for (const tc of providerMsg.tool_calls ?? []) {
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

  return {
    id: messageId ?? `msg_${Date.now()}`,
    role: providerMsg.role as Message["role"],
    parts,
    timestamp: Date.now(),
  };
}
