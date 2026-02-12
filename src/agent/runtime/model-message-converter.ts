/**
 * Model Message Converter
 *
 * Converts between veryfront's internal Message format and AI SDK ModelMessage format.
 * Used when calling streamText() / generateText() from the AI SDK.
 *
 * @module ai/agent/runtime/model-message-converter
 */

import type { ModelMessage } from "ai";
import {
  getTextFromParts,
  getToolArguments,
  type Message,
  type ToolCallPart,
  type ToolResultPart,
} from "../types.ts";

interface TextContent {
  type: "text";
  text: string;
}

interface ToolCallContent {
  type: "tool-call";
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
}

type AssistantContent = TextContent | ToolCallContent;

/**
 * Convert a veryfront Message to AI SDK ModelMessage format.
 */
export function convertToModelMessage(msg: Message): ModelMessage {
  switch (msg.role) {
    case "system": {
      const text = getTextFromParts(msg.parts);
      return { role: "system", content: text };
    }

    case "user": {
      const text = getTextFromParts(msg.parts);
      return { role: "user", content: text };
    }

    case "assistant": {
      const content: AssistantContent[] = [];

      for (const part of msg.parts) {
        if (part.type === "text" && "text" in part) {
          content.push({ type: "text", text: (part as { text: string }).text });
          continue;
        }

        // Tool call parts (tool-${name} or tool-call format)
        if (
          part.type === "tool-call" ||
          (part.type.startsWith("tool-") && part.type !== "tool-result")
        ) {
          const toolPart = part as ToolCallPart;
          content.push({
            type: "tool-call",
            toolCallId: toolPart.toolCallId,
            toolName: toolPart.toolName,
            input: getToolArguments(toolPart),
          });
        }
      }

      // Ensure non-empty content (providers need at least empty text for tool-only messages)
      if (content.length === 0) {
        content.push({ type: "text", text: "" });
      }

      return { role: "assistant", content } as ModelMessage;
    }

    case "tool": {
      const content: Array<{
        type: "tool-result";
        toolCallId: string;
        toolName: string;
        output: { type: "json"; value: unknown };
      }> = [];

      for (const part of msg.parts) {
        if (part.type !== "tool-result") continue;

        const resultPart = part as ToolResultPart;
        content.push({
          type: "tool-result",
          toolCallId: resultPart.toolCallId,
          toolName: resultPart.toolName ?? "unknown",
          output: { type: "json", value: resultPart.result },
        });
      }

      return { role: "tool", content } as ModelMessage;
    }

    default: {
      // Fallback: treat as user message
      const text = getTextFromParts(msg.parts);
      return { role: "user", content: text };
    }
  }
}

/**
 * Convert an array of veryfront Messages to AI SDK ModelMessage format.
 */
export function convertToModelMessages(messages: Message[]): ModelMessage[] {
  return messages.map(convertToModelMessage);
}
