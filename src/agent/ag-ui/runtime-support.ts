import type { Message } from "../types.ts";
import type { AgUiRuntimeRequest } from "../runtime/ag-ui-contract.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseToolArguments(serializedArguments: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(serializedArguments);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function normalizeAgUiRuntimeMessages(
  messages: AgUiRuntimeRequest["messages"],
): Message[] {
  return messages.map((message) => {
    const parts: Message["parts"] = [];

    switch (message.role) {
      case "system":
      case "user":
        parts.push({ type: "text", text: message.content });
        break;
      case "assistant":
        if (typeof message.content === "string" && message.content.length > 0) {
          parts.push({ type: "text", text: message.content });
        }
        for (const toolCall of message.toolCalls ?? []) {
          parts.push({
            type: "tool-call",
            toolCallId: toolCall.id,
            toolName: toolCall.function.name,
            args: parseToolArguments(toolCall.function.arguments),
          });
        }
        break;
      case "tool":
        parts.push({
          type: "tool-result",
          toolCallId: message.toolCallId,
          toolName: "unknown",
          result: message.error
            ? {
              content: message.content,
              error: message.error,
            }
            : message.content,
        });
        break;
    }

    return {
      id: message.id,
      role: message.role,
      parts,
      ...(message.createdAt ? { timestamp: Date.parse(message.createdAt) || undefined } : {}),
      ...(message.metadata ? { metadata: message.metadata } : {}),
    };
  });
}
