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
  TextGenerationRuntimeToolResultPart,
} from "./text-generation-runtime-message-types.ts";
import { buildDataFileAnnotation } from "#veryfront/chat/types.ts";
import { getTextFromParts, getToolArguments, type Message, type ToolCallPart } from "../types.ts";

function getStringPartField(part: unknown, key: string): string | undefined {
  if (!part || typeof part !== "object" || Array.isArray(part)) return undefined;

  const value = (part as Record<string, unknown>)[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getRecordPartField(part: unknown, key: string): Record<string, unknown> | undefined {
  if (!isRecord(part)) return undefined;

  const value = part[key];
  return isRecord(value) ? value : undefined;
}

function hasOwnField(part: Record<string, unknown>, key: string): boolean {
  return Object.hasOwn(part, key);
}

function isProviderExecutedToolPart(part: Record<string, unknown>): boolean {
  return part.providerExecuted === true;
}

function getToolCallId(part: unknown): string | undefined {
  return getStringPartField(part, "toolCallId") ??
    getStringPartField(part, "tool_call_id") ??
    getStringPartField(part, "id");
}

function getProviderExecutedToolCallId(part: unknown): string | undefined {
  if (!isRecord(part) || !isProviderExecutedToolPart(part)) {
    return undefined;
  }

  return getToolCallId(part);
}

function shouldSkipProviderExecutedToolResult(
  part: unknown,
  providerExecutedToolCallIds: Set<string>,
): boolean {
  if (!isRecord(part)) {
    return false;
  }

  if (isProviderExecutedToolPart(part)) {
    return true;
  }

  const toolCallId = getToolCallId(part);
  if (!toolCallId || !providerExecutedToolCallIds.has(toolCallId)) {
    return false;
  }

  providerExecutedToolCallIds.delete(toolCallId);
  return true;
}

function getToolInputRecord(part: Record<string, unknown>): Record<string, unknown> {
  return getRecordPartField(part, "args") ?? getRecordPartField(part, "input") ?? {};
}

function getTextGenerationToolCallPart(
  part: unknown,
): TextGenerationRuntimeToolCallPart | null {
  if (!isRecord(part) || typeof part.type !== "string") {
    return null;
  }

  if (
    part.type !== "tool_call" &&
    part.type !== "tool-call" &&
    !(part.type.startsWith("tool-") && part.type !== "tool-result")
  ) {
    return null;
  }
  if (isProviderExecutedToolPart(part)) {
    return null;
  }

  const toolCallId = getToolCallId(part);
  const toolName = getStringPartField(part, "toolName") ??
    getStringPartField(part, "tool_name") ??
    getStringPartField(part, "name") ??
    (part.type.startsWith("tool-") && part.type !== "tool-call"
      ? part.type.replace(/^tool-/, "")
      : undefined);

  if (!toolCallId || !toolName) {
    return null;
  }

  return {
    type: "tool-call",
    toolCallId,
    toolName,
    input: getToolInputRecord(part),
  };
}

function getTextGenerationToolResultPart(
  part: unknown,
  toolNamesById: ReadonlyMap<string, string>,
): TextGenerationRuntimeToolResultPart | null {
  if (!isRecord(part) || part.type !== "tool-result" && part.type !== "tool_result") {
    return null;
  }

  const toolCallId = getToolCallId(part);
  if (!toolCallId) {
    return null;
  }

  const value = hasOwnField(part, "result")
    ? part.result
    : hasOwnField(part, "output")
    ? part.output
    : null;

  return {
    type: "tool-result",
    toolCallId,
    toolName: getStringPartField(part, "toolName") ??
      getStringPartField(part, "tool_name") ??
      toolNamesById.get(toolCallId) ??
      "unknown",
    output: { type: "json", value },
  };
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
export function convertToTextGenerationRuntimeMessage(
  msg: Message,
  options: { providerExecutedToolCallIds?: Set<string> } = {},
): TextGenerationRuntimeMessage {
  const providerExecutedToolCallIds = options.providerExecutedToolCallIds ?? new Set<string>();

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

        const toolPart = getTextGenerationToolCallPart(part);
        if (toolPart) {
          content.push({
            type: "tool-call",
            toolCallId: toolPart.toolCallId,
            toolName: toolPart.toolName,
            input: part.type === "tool_call"
              ? toolPart.input
              : getToolArguments(part as ToolCallPart),
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
      const toolNamesById = new Map<string, string>();

      for (const part of msg.parts) {
        if (
          shouldSkipProviderExecutedToolResult(part, providerExecutedToolCallIds)
        ) {
          continue;
        }

        const toolResultPart = getTextGenerationToolResultPart(part, toolNamesById);
        if (toolResultPart) {
          content.push(toolResultPart);
        }
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

function hasProviderSendableAssistantContent(message: Message): boolean {
  if (message.role !== "assistant") return true;

  return message.parts.some((part) => {
    if (part.type === "text" && "text" in part) {
      return typeof (part as { text?: unknown }).text === "string" &&
        (part as { text: string }).text.length > 0;
    }

    return getTextGenerationToolCallPart(part) !== null;
  });
}

function convertAssistantMessageToTextGenerationRuntimeMessages(
  message: Message,
  providerExecutedToolCallIds: Set<string>,
): TextGenerationRuntimeMessage[] {
  const assistantContent: TextGenerationRuntimeAssistantMessage["content"] = [];
  const deferredAssistantContent: TextGenerationRuntimeAssistantMessage["content"] = [];
  const toolResults: TextGenerationRuntimeToolMessage["content"] = [];
  const pendingToolCallIds = new Set<string>();
  const toolNamesById = new Map<string, string>();
  const messages: TextGenerationRuntimeMessage[] = [];

  const flushAssistantMessage = (content: TextGenerationRuntimeAssistantMessage["content"]) => {
    if (content.length === 0) {
      return;
    }

    messages.push({ role: "assistant", content: [...content] });
    content.length = 0;
  };

  const flushToolMessage = () => {
    if (toolResults.length === 0) {
      return;
    }

    messages.push({ role: "tool", content: [...toolResults] });
    toolResults.length = 0;
  };

  const pushAssistantPart = (
    part: TextGenerationRuntimeTextPart | TextGenerationRuntimeToolCallPart,
  ) => {
    if (part.type === "tool-call") {
      providerExecutedToolCallIds.delete(part.toolCallId);

      if (deferredAssistantContent.length > 0) {
        flushAssistantMessage(assistantContent);
        flushToolMessage();
        flushAssistantMessage(deferredAssistantContent);
      }

      assistantContent.push(part);
      pendingToolCallIds.add(part.toolCallId);
      toolNamesById.set(part.toolCallId, part.toolName);
      return;
    }

    if (pendingToolCallIds.size > 0) {
      deferredAssistantContent.push(part);
      return;
    }

    if (toolResults.length > 0) {
      flushAssistantMessage(assistantContent);
      flushToolMessage();
      flushAssistantMessage(deferredAssistantContent);
    }

    assistantContent.push(part);
  };

  const pushToolResult = (part: TextGenerationRuntimeToolResultPart) => {
    if (!pendingToolCallIds.has(part.toolCallId)) {
      return;
    }

    toolResults.push(part);
    pendingToolCallIds.delete(part.toolCallId);
  };

  for (const part of message.parts) {
    const providerExecutedToolCallId = getProviderExecutedToolCallId(part);
    if (providerExecutedToolCallId) {
      providerExecutedToolCallIds.add(providerExecutedToolCallId);
    }

    if (part.type === "text" && "text" in part) {
      pushAssistantPart({ type: "text", text: (part as { text: string }).text });
      continue;
    }

    const toolCallPart = getTextGenerationToolCallPart(part);
    if (toolCallPart) {
      pushAssistantPart(toolCallPart);
      continue;
    }

    if (shouldSkipProviderExecutedToolResult(part, providerExecutedToolCallIds)) {
      continue;
    }

    const toolResultPart = getTextGenerationToolResultPart(part, toolNamesById);
    if (toolResultPart) {
      pushToolResult(toolResultPart);
    }
  }

  flushAssistantMessage(assistantContent);
  flushToolMessage();
  flushAssistantMessage(deferredAssistantContent);

  return messages;
}

/**
 * Convert an array of veryfront Messages to the current text-generation runtime message format.
 */
export function convertToTextGenerationRuntimeMessages(
  messages: Message[],
): TextGenerationRuntimeMessage[] {
  const textGenerationRuntimeMessages: TextGenerationRuntimeMessage[] = [];
  const providerExecutedToolCallIds = new Set<string>();

  for (const message of messages) {
    if (message.role === "user" || message.role === "system") {
      providerExecutedToolCallIds.clear();
    }

    for (const part of message.parts) {
      const providerExecutedToolCallId = getProviderExecutedToolCallId(part);
      if (providerExecutedToolCallId) {
        providerExecutedToolCallIds.add(providerExecutedToolCallId);
      }
    }

    if (!hasProviderSendableAssistantContent(message)) {
      continue;
    }

    const convertedMessages = message.role === "assistant"
      ? convertAssistantMessageToTextGenerationRuntimeMessages(message, providerExecutedToolCallIds)
      : [convertToTextGenerationRuntimeMessage(message, { providerExecutedToolCallIds })];

    for (const convertedMessage of convertedMessages) {
      if (convertedMessage.role === "tool" && convertedMessage.content.length === 0) {
        continue;
      }

      const previousMessage = textGenerationRuntimeMessages.at(-1);

      if (previousMessage?.role === "tool" && convertedMessage.role === "tool") {
        previousMessage.content.push(...convertedMessage.content);
        continue;
      }

      textGenerationRuntimeMessages.push(convertedMessage);
    }
  }

  return textGenerationRuntimeMessages;
}
