/**
 * Text-Generation Runtime Message Converter
 *
 * Converts between veryfront's internal Message format and the current
 * text-generation runtime message format.
 *
 * @module ai/agent/runtime/text-generation-runtime-message-converter
 */

import type {
  TextGenerationRuntimeAssistantMessage,
  TextGenerationRuntimeFilePart,
  TextGenerationRuntimeMessage,
  TextGenerationRuntimeTextPart,
  TextGenerationRuntimeToolCallPart,
  TextGenerationRuntimeToolMessage,
} from "./text-generation-runtime-message-types.ts";
import { buildDataFileAnnotation } from "#veryfront/chat/types.ts";
import {
  getTextFromParts,
  getToolArguments,
  type Message,
  type ToolCallPart,
  type ToolResultPart,
} from "../types.ts";

function getStringPartField(part: unknown, key: string): string | undefined {
  if (!part || typeof part !== "object" || Array.isArray(part)) return undefined;

  const value = (part as Record<string, unknown>)[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function buildAttachmentContextFromParts(parts: Message["parts"]): string {
  const refs = parts.flatMap((part) => {
    const type = getStringPartField(part, "type");
    if (type !== "file" && type !== "image") return [];

    const mediaType = getStringPartField(part, "mediaType");
    if (!mediaType) return [];

    const uploadId = getStringPartField(part, "uploadId");
    const uploadPath = getStringPartField(part, "uploadPath");
    const url = getStringPartField(part, "url");

    return [{
      name: getStringPartField(part, "filename") ?? (type === "image" ? "image" : "file"),
      mediaType,
      ...(uploadId ? { uploadId } : {}),
      ...(uploadPath ? { path: uploadPath } : {}),
      ...(url ? { url } : {}),
    }];
  });

  return refs.length > 0 ? buildDataFileAnnotation(refs) : "";
}

function appendReadableAttachmentContext(text: string, attachmentContext: string): string {
  const normalizedContext = attachmentContext.trimStart();
  if (!normalizedContext) {
    return text;
  }

  if (text.length === 0) {
    return normalizedContext;
  }

  const separator = text.endsWith("\n\n") ? "" : text.endsWith("\n") ? "\n" : "\n\n";
  return `${text}${separator}${normalizedContext}`;
}

function getUserTextWithAttachmentContext(parts: Message["parts"]): string {
  const text = getTextFromParts(parts);
  return text.includes("<uploaded_files>")
    ? text
    : appendReadableAttachmentContext(text, buildAttachmentContextFromParts(parts));
}

function getUserFileParts(parts: Message["parts"]): TextGenerationRuntimeFilePart[] {
  return parts.flatMap((part) => {
    const type = getStringPartField(part, "type");
    if (type !== "file" && type !== "image") return [];

    const mediaType = getStringPartField(part, "mediaType");
    const url = getStringPartField(part, "url");
    if (!mediaType || !url || url.startsWith("data:")) return [];

    return [{
      type,
      mediaType,
      url,
      ...(getStringPartField(part, "filename")
        ? { filename: getStringPartField(part, "filename") }
        : {}),
    }];
  });
}

/**
 * Convert a veryfront Message to the current text-generation runtime message format.
 */
export function convertToTextGenerationRuntimeMessage(msg: Message): TextGenerationRuntimeMessage {
  switch (msg.role) {
    case "system": {
      const text = getTextFromParts(msg.parts);
      return { role: "system", content: text };
    }

    case "user": {
      const fileParts = getUserFileParts(msg.parts);
      if (fileParts.length === 0) {
        const text = getUserTextWithAttachmentContext(msg.parts);
        return { role: "user", content: text };
      }

      const text = getTextFromParts(msg.parts);
      const attachmentContext = text.includes("<uploaded_files>")
        ? ""
        : buildAttachmentContextFromParts(msg.parts);
      return {
        role: "user",
        content: [
          ...(text.length > 0 ? [{ type: "text" as const, text }] : []),
          ...fileParts,
          ...(attachmentContext.length > 0
            ? [{ type: "text" as const, text: attachmentContext.trimStart() }]
            : []),
        ],
      };
    }

    case "assistant": {
      const content: Array<TextGenerationRuntimeTextPart | TextGenerationRuntimeToolCallPart> = [];

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

      const assistantMessage: TextGenerationRuntimeAssistantMessage = {
        role: "assistant",
        content,
      };
      return assistantMessage;
    }

    case "tool": {
      const content: TextGenerationRuntimeToolMessage["content"] = [];

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

      const toolMessage: TextGenerationRuntimeToolMessage = { role: "tool", content };
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
): TextGenerationRuntimeToolMessage {
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
 * Convert an array of veryfront Messages to the current text-generation runtime message format.
 */
export function convertToTextGenerationRuntimeMessages(
  messages: Message[],
): TextGenerationRuntimeMessage[] {
  const textGenerationRuntimeMessages: TextGenerationRuntimeMessage[] = [];
  const toolResultMessageIndexes = new Map<string, number>();

  for (const message of messages) {
    if (message.role !== "tool") {
      textGenerationRuntimeMessages.push(convertToTextGenerationRuntimeMessage(message));
      continue;
    }

    const toolResultParts = message.parts.filter((part): part is ToolResultPart =>
      part.type === "tool-result"
    );

    if (toolResultParts.length === 0) {
      textGenerationRuntimeMessages.push(convertToTextGenerationRuntimeMessage(message));
      continue;
    }

    for (const toolResultPart of toolResultParts) {
      const toolResultMessage = convertToolResultPart(toolResultPart);
      const existingIndex = toolResultMessageIndexes.get(toolResultPart.toolCallId);

      if (existingIndex === undefined) {
        toolResultMessageIndexes.set(
          toolResultPart.toolCallId,
          textGenerationRuntimeMessages.length,
        );
        textGenerationRuntimeMessages.push(toolResultMessage);
        continue;
      }

      textGenerationRuntimeMessages[existingIndex] = toolResultMessage;
    }
  }

  return textGenerationRuntimeMessages;
}
