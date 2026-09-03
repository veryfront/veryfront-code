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
import { assertProviderReachableAttachment } from "./attachment-reachability.ts";
import { buildDataFileAnnotation } from "#veryfront/chat/types.ts";
import { getTextFromParts, getToolArguments, type Message, type ToolCallPart } from "../types.ts";
import {
  isProviderReplayDelivered,
  markProviderReplayDelivered,
  readAttachedProviderMetadata,
} from "./provider-metadata.ts";
import {
  collectAnthropicProviderToolCallIds,
  groupAnthropicRawAssistantMessagesByAnchor,
} from "./anthropic-provider-replay-block.ts";

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

  if (part.type !== "tool-result" && part.type !== "tool_result") {
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
  providerExecutedToolCallIds: ReadonlySet<string> = new Set(),
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
  if (isProviderExecutedToolPart(part) || providerExecutedToolCallIds.has(toolCallId)) {
    return null;
  }

  return {
    type: "tool-call",
    toolCallId,
    toolName,
    input: getToolInputRecord(part),
  };
}

function addProviderMetadataToolCallIds(
  message: Message,
  providerExecutedToolCallIds: Set<string>,
): void {
  const metadata = readAttachedProviderMetadata(message);
  if (!isRecord(metadata) || !isRecord(metadata.anthropic)) return;
  for (
    const id of collectAnthropicProviderToolCallIds(metadata.anthropic.rawAssistantMessages)
  ) {
    providerExecutedToolCallIds.add(id);
  }
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
      // Never inline a `data:` URL here — it would dump the whole base64 blob
      // into the prompt as text. The bytes ride in the native file part below.
      ...(url && !url.startsWith("data:") ? { url } : {}),
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

function getUserFileParts(
  parts: Message["parts"],
  requireInternetReachableAttachments: boolean,
): TextGenerationRuntimeFilePart[] {
  return parts.flatMap((part) => {
    const type = getStringPartField(part, "type");
    if (type !== "file" && type !== "image") return [];

    const mediaType = getStringPartField(part, "mediaType");
    const url = getStringPartField(part, "url");
    // `data:` URLs (inline base64) are kept so the model receives the bytes as a
    // native image/file part (guest / no-project attachments have no fetchable URL).
    if (!mediaType || !url) return [];

    // A remote provider dereferences this URL from its own network. A URL that
    // can never resolve there comes back as a bare 400 that names nothing, so
    // it fails here instead, naming the attachment. A server-local runtime
    // fetches from this machine, where those URLs do resolve, so it is exempt.
    if (requireInternetReachableAttachments) {
      assertProviderReachableAttachment({
        url,
        filename: getStringPartField(part, "filename"),
        mediaType,
      });
    }

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
 * How a converted prompt will reach the model.
 *
 * `requireInternetReachableAttachments` says whether the runtime that receives
 * this prompt fetches attachment URLs from its own network — every remote
 * provider does, and a `server-local` runtime does not. Defaulting to `true`
 * keeps the check on for the common case; callers holding the runtime turn it
 * off (`src/agent/runtime/index.ts`).
 */
export interface TextGenerationRuntimeConversionOptions {
  requireInternetReachableAttachments?: boolean;
}

/**
 * Convert a veryfront Message to the current text-generation runtime message format.
 */
export function convertToTextGenerationRuntimeMessage(
  msg: Message,
  options:
    & { providerExecutedToolCallIds?: Set<string> }
    & TextGenerationRuntimeConversionOptions = {},
): TextGenerationRuntimeMessage {
  const providerExecutedToolCallIds = options.providerExecutedToolCallIds ?? new Set<string>();
  addProviderMetadataToolCallIds(msg, providerExecutedToolCallIds);
  const requireInternetReachableAttachments = options.requireInternetReachableAttachments ?? true;

  switch (msg.role) {
    case "system": {
      const text = getTextFromParts(msg.parts);
      return { role: "system", content: text };
    }

    case "user": {
      const fileParts = getUserFileParts(msg.parts, requireInternetReachableAttachments);
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

        const toolPart = getTextGenerationToolCallPart(part, providerExecutedToolCallIds);
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

      const providerMetadata = readAttachedProviderMetadata(msg);
      const assistantMessage: TextGenerationRuntimeAssistantMessage = {
        role: "assistant",
        content,
        ...(providerMetadata === undefined ? {} : { providerMetadata }),
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

/**
 * Track, message by message, whether conversion drops each message from the
 * provider prompt entirely.
 *
 * `convertToTextGenerationRuntimeMessages` skips assistant messages with no
 * sendable content, and tool messages whose parts yield no tool-result content
 * are discarded after conversion, including results the provider already
 * executed (`shouldSkipProviderExecutedToolResult`), whose ids accumulate
 * across earlier messages exactly as they do during conversion. The messages
 * on either side of a dropped one become adjacent at the provider, so input
 * validation walks a conversation through one tracker, in order, to mirror
 * that adjacency when it assembles runs of system messages.
 */
export function createProviderDroppedMessageTracker(): (message: Message) => boolean {
  const providerExecutedToolCallIds = new Set<string>();

  return (message: Message): boolean => {
    // Mirror convertToTextGenerationRuntimeMessages: user/system input resets
    // the provider-executed window, then this message's metadata and parts
    // register the tool calls the provider ran itself.
    if (message.role === "user" || message.role === "system") {
      providerExecutedToolCallIds.clear();
    }
    addProviderMetadataToolCallIds(message, providerExecutedToolCallIds);
    for (const part of message.parts) {
      const providerExecutedToolCallId = getProviderExecutedToolCallId(part);
      if (providerExecutedToolCallId) {
        providerExecutedToolCallIds.add(providerExecutedToolCallId);
      }
    }

    if (!hasProviderSendableAssistantContent(message)) return true;

    if (message.role === "assistant") {
      // Mirror the assistant conversion's id bookkeeping: a caller-authored
      // tool call supersedes a provider-executed id (`pushAssistantPart`
      // deletes it), and a replayed provider-executed result consumes its id.
      for (const part of message.parts) {
        const toolCallPart = getTextGenerationToolCallPart(part, providerExecutedToolCallIds);
        if (toolCallPart) {
          providerExecutedToolCallIds.delete(toolCallPart.toolCallId);
          continue;
        }
        shouldSkipProviderExecutedToolResult(part, providerExecutedToolCallIds);
      }
      return false;
    }

    if (message.role !== "tool") return false;

    const toolNamesById = new Map<string, string>();
    let dropped = true;
    for (const part of message.parts) {
      // The skip check runs first for its id-consuming side effect, exactly as
      // in conversion.
      if (shouldSkipProviderExecutedToolResult(part, providerExecutedToolCallIds)) continue;
      if (getTextGenerationToolResultPart(part, toolNamesById)) dropped = false;
    }
    return dropped;
  };
}

function hasProviderSendableAssistantContent(message: Message): boolean {
  if (message.role !== "assistant") return true;
  if (readAttachedProviderMetadata(message) !== undefined) return true;

  return message.parts.some((part) => {
    if (part.type === "text" && "text" in part) {
      return typeof (part as { text?: unknown }).text === "string" &&
        (part as { text: string }).text.length > 0;
    }

    return getTextGenerationToolCallPart(part) !== null;
  });
}

function splitAnthropicProviderMetadata(
  providerMetadata: Record<string, unknown>,
  segmentCount: number,
): Record<string, unknown>[] | undefined {
  if (!isRecord(providerMetadata.anthropic)) return undefined;
  const anthropic = providerMetadata.anthropic;
  const grouped = groupAnthropicRawAssistantMessagesByAnchor(
    anthropic.rawAssistantMessages,
    segmentCount,
  );
  return grouped?.map((rawAssistantMessages) => ({
    ...providerMetadata,
    anthropic: { ...anthropic, rawAssistantMessages },
  }));
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

    const toolCallPart = getTextGenerationToolCallPart(part, providerExecutedToolCallIds);
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

  const providerMetadata = readAttachedProviderMetadata(message);
  const assistantMessages = messages.filter((entry) => entry.role === "assistant");
  if (providerMetadata !== undefined && assistantMessages.length === 1) {
    assistantMessages[0]!.providerMetadata = providerMetadata;
    if (isProviderReplayDelivered(message)) {
      markProviderReplayDelivered(assistantMessages[0]!);
    }
  } else if (providerMetadata !== undefined && messages.length === 0) {
    const anchorMessage: TextGenerationRuntimeMessage = {
      role: "assistant",
      content: [{ type: "text", text: "" }],
      providerMetadata,
    };
    if (isProviderReplayDelivered(message)) {
      markProviderReplayDelivered(anchorMessage);
    }
    messages.push(anchorMessage);
  } else if (providerMetadata !== undefined) {
    const splitMetadata = splitAnthropicProviderMetadata(
      providerMetadata,
      assistantMessages.length,
    );
    if (splitMetadata === undefined) {
      throw new TypeError("Provider replay metadata cannot follow a split assistant turn");
    }
    for (const [index, assistantMessage] of assistantMessages.entries()) {
      assistantMessage.providerMetadata = splitMetadata[index];
      if (isProviderReplayDelivered(message)) {
        markProviderReplayDelivered(assistantMessage);
      }
    }
  }

  return messages;
}

/**
 * Convert an array of veryfront Messages to the current text-generation runtime message format.
 */
export function convertToTextGenerationRuntimeMessages(
  messages: Message[],
  options: TextGenerationRuntimeConversionOptions = {},
): TextGenerationRuntimeMessage[] {
  const textGenerationRuntimeMessages: TextGenerationRuntimeMessage[] = [];
  const providerExecutedToolCallIds = new Set<string>();

  for (const message of messages) {
    if (message.role === "user" || message.role === "system") {
      providerExecutedToolCallIds.clear();
    }
    addProviderMetadataToolCallIds(message, providerExecutedToolCallIds);

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
      : [convertToTextGenerationRuntimeMessage(message, {
        providerExecutedToolCallIds,
        ...options,
      })];

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

/**
 * Convert messages for a provider request.
 *
 * Some providers reject assistant-prefill transcripts and require the prompt to
 * end at user/tool input. Persisted runtime history may temporarily end with an
 * assistant-only continuation message between streamed tool steps, so trim that
 * replay-only tail at the provider boundary without changing stored history.
 */
export function convertToTextGenerationRuntimeRequestMessages(
  messages: Message[],
  options: TextGenerationRuntimeConversionOptions = {},
): TextGenerationRuntimeMessage[] {
  const requestMessages = convertToTextGenerationRuntimeMessages(messages, options);

  // Only a delivered replay checkpoint may keep a trailing assistant message:
  // live in-run metadata also reaches converted messages, and providers reject
  // or misread an unexpected trailing prefill on ordinary resumes.
  while (
    requestMessages.at(-1)?.role === "assistant" &&
    !isProviderReplayDelivered(requestMessages.at(-1))
  ) {
    requestMessages.pop();
  }

  return requestMessages;
}
