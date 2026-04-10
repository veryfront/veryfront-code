/**
 * Model Message Converter
 *
 * Converts between veryfront's internal Message format and the current
 * model-runtime message format.
 *
 * @module ai/agent/runtime/model-message-converter
 */

import type {
  ModelRuntimeAssistantMessage,
  ModelRuntimeMessage,
  ModelRuntimeTextPart,
  ModelRuntimeToolCallPart,
  ModelRuntimeToolMessage,
} from "./model-runtime-types.ts";
import {
  getTextFromParts,
  getToolArguments,
  type Message,
  type ToolCallPart,
  type ToolResultPart,
} from "../types.ts";

/**
 * Convert a veryfront Message to the current model-runtime message format.
 */
export function convertToModelMessage(msg: Message): ModelRuntimeMessage {
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
      const content: Array<ModelRuntimeTextPart | ModelRuntimeToolCallPart> = [];

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

      const assistantMessage: ModelRuntimeAssistantMessage = { role: "assistant", content };
      return assistantMessage;
    }

    case "tool": {
      const content: ModelRuntimeToolMessage["content"] = [];

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

      const toolMessage: ModelRuntimeToolMessage = { role: "tool", content };
      return toolMessage;
    }

    default: {
      // Fallback: treat as user message
      const text = getTextFromParts(msg.parts);
      return { role: "user", content: text };
    }
  }
}

function convertToolResultPart(
  part: ToolResultPart,
): ModelRuntimeToolMessage {
  return {
    role: "tool",
    content: [{
      type: "tool-result",
      toolCallId: part.toolCallId,
      toolName: part.toolName ?? "unknown",
      output: { type: "json", value: part.result },
    }],
  };
}

/**
 * Convert an array of veryfront Messages to the current model-runtime message format.
 */
export function convertToModelMessages(messages: Message[]): ModelRuntimeMessage[] {
  const modelMessages: ModelRuntimeMessage[] = [];
  const toolResultMessageIndexes = new Map<string, number>();

  for (const message of messages) {
    if (message.role !== "tool") {
      modelMessages.push(convertToModelMessage(message));
      continue;
    }

    const toolResultParts = message.parts.filter((part): part is ToolResultPart =>
      part.type === "tool-result"
    );

    if (toolResultParts.length === 0) {
      modelMessages.push(convertToModelMessage(message));
      continue;
    }

    for (const toolResultPart of toolResultParts) {
      const toolResultMessage = convertToolResultPart(toolResultPart);
      const existingIndex = toolResultMessageIndexes.get(toolResultPart.toolCallId);

      if (existingIndex === undefined) {
        toolResultMessageIndexes.set(toolResultPart.toolCallId, modelMessages.length);
        modelMessages.push(toolResultMessage);
        continue;
      }

      modelMessages[existingIndex] = toolResultMessage;
    }
  }

  return modelMessages;
}
