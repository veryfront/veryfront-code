import { z } from "zod";
import type { ChatUiMessage, ChatUiMessagePart, ProviderModelMessage } from "./types.ts";

const textPartSchema = z.object({ type: z.literal("text"), text: z.string() });
const imagePartSchema = z.object({
  type: z.literal("image"),
  upload_id: z.string().uuid(),
  media_type: z.string(),
  url: z.string().optional(),
});
const filePartSchema = z.object({
  type: z.literal("file"),
  upload_id: z.string().uuid(),
  media_type: z.string(),
  filename: z.string().optional(),
  url: z.string().optional(),
});
const toolCallPartSchema = z.object({
  type: z.literal("tool_call"),
  id: z.string(),
  name: z.string(),
  input: z.record(z.string(), z.unknown()),
  state: z.enum(["streaming", "pending", "completed", "error"]),
});
const toolResultPartSchema = z.object({
  type: z.literal("tool_result"),
  tool_call_id: z.string(),
  output: z.unknown(),
  is_error: z.boolean().optional(),
});
const reasoningPartSchema = z.object({
  type: z.literal("reasoning"),
  text: z.string(),
  signature: z.string().optional(),
});
const citationPartSchema = z.object({
  type: z.literal("citation"),
  source_id: z.string(),
  url: z.string().optional(),
  title: z.string().optional(),
  quote: z.string().optional(),
});
const stepStartPartSchema = z.object({ type: z.literal("step_start") });
const errorPartSchema = z.object({
  type: z.literal("error"),
  code: z.string(),
  message: z.string(),
});
const dataPartSchema = z.object({ type: z.literal("data"), name: z.string(), value: z.unknown() });

export const messagePartSchema = z.discriminatedUnion("type", [
  textPartSchema,
  imagePartSchema,
  filePartSchema,
  toolCallPartSchema,
  toolResultPartSchema,
  reasoningPartSchema,
  citationPartSchema,
  stepStartPartSchema,
  errorPartSchema,
  dataPartSchema,
]);

export type MessagePart = z.infer<typeof messagePartSchema>;

export const conversationTypeSchema = z.enum([
  "chat",
  "agent_task",
  "support",
  "channel",
  "project_agent",
]);
export type ConversationType = z.infer<typeof conversationTypeSchema>;

export const messageStatusSchema = z.enum([
  "pending",
  "streaming",
  "completed",
  "error",
  "failed",
  "cancelled",
  "stopped",
]);
export type MessageStatus = z.infer<typeof messageStatusSchema>;

export const apiConversationSchema = z.object({
  id: z.string(),
  projectId: z.string().nullable().optional(),
  type: conversationTypeSchema,
  title: z.string().nullable().optional(),
  status: z.enum(["active", "archived", "deleted"]),
  summary: z.string().nullable().optional(),
  currentNode: z.string().nullable().optional(),
  messageCount: z.number(),
  lastMessageAt: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  createdBy: z.string(),
  archivedAt: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type ApiConversation = z.infer<typeof apiConversationSchema>;

export const apiMessageSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  parentId: z.string().nullable(),
  seq: z.number(),
  role: z.enum(["user", "assistant", "tool"]),
  parts: z.array(messagePartSchema),
  status: messageStatusSchema,
  model: z.string().nullable(),
  tokenUsage: z.object({ input: z.number(), output: z.number() }).nullable(),
  finishReason: z.string().nullable(),
  costCredits: z.string().nullable().optional(),
  createdBy: z.string().nullable(),
  editedAt: z.string().nullable().optional(),
  idempotencyKey: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.string(),
  updatedAt: z.string().nullable(),
});

export type ApiMessage = z.infer<typeof apiMessageSchema>;

export interface ToolCallLike {
  type: "tool-call";
  toolCallId: string;
  toolName: string;
  input: unknown;
  providerExecuted?: boolean;
}

export interface ToolResultLike {
  type: "tool-result";
  toolCallId: string;
  toolName: string;
  output: unknown;
  providerOptions?: unknown;
}

export interface TextPartLike {
  type: "text";
  text: string;
}

export interface ReasoningPartLike {
  type: "reasoning";
  text: string;
}

type ToolUiPart = Extract<ChatUiMessagePart, { toolCallId: string; state: string }>;
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export const UUID_PATTERN =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i;

export function isUuid(value: string | null | undefined): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function extractUploadId(url: string): string | null {
  const match = url.match(UUID_PATTERN);
  return match ? match[0] : null;
}

export function mapToolState(sdkState: string): "streaming" | "pending" | "completed" | "error" {
  switch (sdkState) {
    case "input-streaming":
      return "streaming";
    case "input-available":
    case "approval-requested":
    case "approval-responded":
      return "pending";
    case "output-available":
      return "completed";
    case "output-error":
    case "output-denied":
    case "error":
      return "error";
    default:
      return "pending";
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function getStringField(value: unknown, field: string, fallback: string): string {
  if (!isRecord(value) || typeof value[field] !== "string") {
    return fallback;
  }

  return value[field];
}

function getOptionalStringField(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const field = value[key];
  return typeof field === "string" ? field : undefined;
}

function getNonEmptyStringField(value: unknown, key: string): string | undefined {
  const field = getOptionalStringField(value, key);
  return field && field.length > 0 ? field : undefined;
}

function toRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? Object.fromEntries(Object.entries(value)) : {};
}

export function stringifyUnknown(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    const serialized = JSON.stringify(value);
    return serialized ?? String(value);
  } catch {
    return String(value);
  }
}

export function isDataUiPart(
  part: ChatUiMessagePart,
): part is ChatUiMessagePart & { type: `data-${string}`; data: unknown } {
  return part.type.startsWith("data-") && "data" in part;
}

export function isToolUiPart(part: ChatUiMessagePart): part is ToolUiPart {
  return (
    (part.type === "dynamic-tool" || part.type.startsWith("tool-")) &&
    typeof getOptionalStringField(part, "toolCallId") === "string" &&
    typeof getOptionalStringField(part, "state") === "string"
  );
}

export function getUiToolName(part: ToolUiPart): string | undefined {
  const explicitToolName = getOptionalStringField(part, "toolName");
  if (explicitToolName) {
    return explicitToolName;
  }

  return part.type.startsWith("tool-") ? part.type.replace(/^tool-/, "") : undefined;
}

export function pushToolParts(
  parts: MessagePart[],
  toolName: string,
  toolCallId: string,
  state: string,
  part: {
    input?: unknown;
    output?: unknown;
    errorText?: unknown;
  },
): void {
  const input = toRecord(part.input);
  const isErroredState = state === "output-error" || state === "error" || state === "output-denied";
  const hasResultState = state === "output-available" || isErroredState;

  if (hasResultState) {
    parts.push({
      type: "tool_call",
      id: toolCallId,
      name: toolName,
      input,
      state: "completed",
    });

    const resultOutput = isErroredState
      ? part.output ?? part.errorText ?? "Tool error"
      : part.output ?? null;
    parts.push({
      type: "tool_result",
      tool_call_id: toolCallId,
      output: resultOutput,
      is_error: isErroredState,
    });
    return;
  }

  parts.push({
    type: "tool_call",
    id: toolCallId,
    name: toolName,
    input,
    state: mapToolState(state),
  });
}

function pushFileConversationPart(
  parts: MessagePart[],
  part: Extract<ChatUiMessagePart, { type: "file" }>,
): void {
  const uploadId = part.uploadId ?? extractUploadId(part.url);
  if (!uploadId) return;

  if (part.mediaType.startsWith("image/")) {
    parts.push({
      type: "image",
      upload_id: uploadId,
      media_type: part.mediaType,
      ...(part.url ? { url: part.url } : {}),
    });
    return;
  }

  parts.push({
    type: "file",
    upload_id: uploadId,
    media_type: part.mediaType,
    ...(part.url ? { url: part.url } : {}),
  });
}

export function toConversationPartsFromUiMessage(message: ChatUiMessage): MessagePart[] {
  const parts: MessagePart[] = [];

  for (const part of message.parts) {
    if (part.type === "text") {
      parts.push({ type: "text", text: part.text });
      continue;
    }

    if (part.type === "reasoning") {
      parts.push({ type: "reasoning", text: part.text });
      continue;
    }

    if (part.type === "step-start") {
      continue;
    }

    if (part.type === "source-url") {
      parts.push({
        type: "citation",
        source_id: part.sourceId,
        title: part.title,
        url: part.url,
      });
      continue;
    }

    if (part.type === "source-document") {
      parts.push({
        type: "citation",
        source_id: part.sourceId,
        title: part.title,
      });
      continue;
    }

    if (part.type === "file") {
      pushFileConversationPart(parts, part);
      continue;
    }

    if (isDataUiPart(part)) {
      const name = part.type.replace(/^data-/, "");
      if (name.length > 0) {
        parts.push({
          type: "data",
          name,
          value: part.data,
        });
      }
      continue;
    }

    if (isToolUiPart(part)) {
      const toolName = getUiToolName(part);
      if (!toolName) {
        continue;
      }

      pushToolParts(parts, toolName, part.toolCallId, part.state, part);
    }
  }

  return parts.filter((part) => messagePartSchema.safeParse(part).success);
}

function isToolComplete(part: ToolUiPart): boolean {
  return part.state === "output-available" || part.state === "output-error" ||
    part.state === "output-denied";
}

export function hasIncompleteToolParts(message: ChatUiMessage): boolean {
  return message.parts.some((part) => isToolUiPart(part) && !isToolComplete(part));
}

export function markIncompleteToolPartsAsStopped(message: ChatUiMessage): ChatUiMessage {
  return markIncompleteToolPartsAsErrored(message, "Stopped by user");
}

export function markIncompleteToolPartsAsErrored(
  message: ChatUiMessage,
  errorText: string,
): ChatUiMessage {
  let mutated = false;

  const parts = message.parts.map((part) => {
    if (!isToolUiPart(part) || isToolComplete(part)) {
      return part;
    }

    mutated = true;
    return markToolPartAsErrored(part, errorText);
  });

  return mutated ? { ...message, parts } : message;
}

function markToolPartAsErrored(part: ToolUiPart, errorText: string): ChatUiMessagePart {
  if (part.type === "dynamic-tool") {
    return {
      type: "dynamic-tool",
      toolName: part.toolName,
      toolCallId: part.toolCallId,
      ...(part.title ? { title: part.title } : {}),
      ...(part.providerExecuted !== undefined ? { providerExecuted: part.providerExecuted } : {}),
      ...(part.callProviderMetadata ? { callProviderMetadata: part.callProviderMetadata } : {}),
      input: part.input,
      state: "output-error",
      errorText,
    };
  }

  return {
    type: part.type,
    toolCallId: part.toolCallId,
    ...(part.toolName ? { toolName: part.toolName } : {}),
    ...(part.title ? { title: part.title } : {}),
    ...(part.providerExecuted !== undefined ? { providerExecuted: part.providerExecuted } : {}),
    ...(part.callProviderMetadata ? { callProviderMetadata: part.callProviderMetadata } : {}),
    input: part.input,
    state: "output-error",
    errorText,
  };
}

export function isToolCallPart(value: unknown): value is ToolCallLike {
  return (
    isRecord(value) &&
    value.type === "tool-call" &&
    typeof value.toolCallId === "string" &&
    typeof value.toolName === "string"
  );
}

export function isToolResultPart(value: unknown): value is ToolResultLike {
  return (
    isRecord(value) &&
    value.type === "tool-result" &&
    typeof value.toolCallId === "string" &&
    typeof value.toolName === "string"
  );
}

export function isTextPart(value: unknown): value is TextPartLike {
  return isRecord(value) && value.type === "text" && typeof value.text === "string";
}

export function isReasoningPart(value: unknown): value is ReasoningPartLike {
  return isRecord(value) && value.type === "reasoning" && typeof value.text === "string";
}

export function extractTextFromMessage(message: ProviderModelMessage): string {
  if (!message || !message.content) return "";

  const { content } = message;

  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    const textParts: string[] = [];
    for (const part of content) {
      if (isTextPart(part)) {
        textParts.push(part.text);
      }
    }
    return textParts.join(" ");
  }

  return "";
}

function toJsonValue(value: unknown): JsonValue {
  if (value == null) {
    return null;
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => toJsonValue(entry));
  }

  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, toJsonValue(entry)]),
    );
  }

  return JSON.stringify(value);
}

function getFilePart(part: unknown): {
  type: "file" | "image";
  mediaType: string;
  data: string;
  url: string;
  filename?: string;
  uploadId?: string;
  uploadPath?: string;
} | null {
  if (!isRecord(part) || (part.type !== "file" && part.type !== "image")) {
    return null;
  }

  const mediaType = getNonEmptyStringField(part, "mediaType") ??
    getNonEmptyStringField(part, "media_type");
  const data = getNonEmptyStringField(part, "url");
  if (!mediaType || !data) {
    return null;
  }

  const filename = getNonEmptyStringField(part, "filename");
  const uploadId = getNonEmptyStringField(part, "uploadId") ??
    getNonEmptyStringField(part, "upload_id");
  const uploadPath = getNonEmptyStringField(part, "uploadPath") ??
    getNonEmptyStringField(part, "upload_path");

  return {
    type: part.type === "image" ? "image" : "file",
    mediaType,
    data,
    url: data,
    ...(filename ? { filename } : {}),
    ...(uploadId ? { uploadId } : {}),
    ...(uploadPath ? { uploadPath } : {}),
  };
}

function getToolPart(part: unknown): {
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
  state: string;
  output?: unknown;
  errorText?: string;
} | null {
  if (!isRecord(part) || typeof part.type !== "string") {
    return null;
  }

  const type = part.type;
  const toolCallId = getNonEmptyStringField(part, "toolCallId");
  const state = getNonEmptyStringField(part, "state");
  const explicitToolName = getNonEmptyStringField(part, "toolName") ??
    getNonEmptyStringField(part, "name");
  const derivedToolName =
    type === "dynamic-tool" || type === "tool_call" || !type.startsWith("tool-")
      ? undefined
      : type.replace(/^tool-/, "");
  const toolName = explicitToolName ?? derivedToolName;
  if (!toolCallId || !state || !toolName) {
    return null;
  }

  const errorText = getOptionalStringField(part, "errorText");
  const output = Object.hasOwn(part, "output") ? part.output : undefined;

  return {
    toolCallId,
    toolName,
    input: toRecord(part.input),
    state,
    ...(output !== undefined ? { output } : {}),
    ...(errorText !== undefined ? { errorText } : {}),
  };
}

function getRawToolCallPart(part: unknown): {
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
} | null {
  if (!isRecord(part) || part.type !== "tool_call") {
    return null;
  }

  const toolCallId = getNonEmptyStringField(part, "toolCallId") ??
    getNonEmptyStringField(part, "tool_call_id") ??
    getNonEmptyStringField(part, "id");
  const toolName = getNonEmptyStringField(part, "toolName") ??
    getNonEmptyStringField(part, "tool_name") ??
    getNonEmptyStringField(part, "name");

  if (!toolCallId || !toolName) {
    return null;
  }

  return {
    toolCallId,
    toolName,
    input: toRecord(part.input),
  };
}

function getRawToolResultPart(part: unknown): {
  toolCallId: string;
  toolName?: string;
  output:
    | {
      type: "json";
      value: JsonValue;
    }
    | {
      type: "error-text";
      value: string;
    };
} | null {
  if (!isRecord(part) || part.type !== "tool_result") {
    return null;
  }

  const toolCallId = getNonEmptyStringField(part, "toolCallId") ??
    getNonEmptyStringField(part, "tool_call_id") ??
    getNonEmptyStringField(part, "id");
  if (!toolCallId) {
    return null;
  }

  const toolName = getNonEmptyStringField(part, "toolName") ??
    getNonEmptyStringField(part, "tool_name") ??
    getNonEmptyStringField(part, "name");
  const isError = part.is_error === true || part.isError === true;
  const output = isError
    ? {
      type: "error-text" as const,
      value: stringifyUnknown(part.output ?? "Tool error"),
    }
    : {
      type: "json" as const,
      value: toJsonValue(part.output),
    };

  return {
    toolCallId,
    ...(toolName ? { toolName } : {}),
    output,
  };
}

function buildRawToolNameMap(parts: ReadonlyArray<unknown>): Map<string, string> {
  const toolNames = new Map<string, string>();

  for (const part of parts) {
    const rawToolCall = getRawToolCallPart(part);
    if (!rawToolCall) {
      continue;
    }

    toolNames.set(rawToolCall.toolCallId, rawToolCall.toolName);
  }

  return toolNames;
}

function buildToolResultOutput(toolPart: { state: string; output?: unknown; errorText?: string }):
  | {
    type: "json";
    value: JsonValue;
  }
  | {
    type: "error-text";
    value: string;
  }
  | null {
  if (toolPart.state === "output-available") {
    return {
      type: "json",
      value: toJsonValue(toolPart.output),
    };
  }

  if (
    toolPart.state === "output-error" || toolPart.state === "output-denied" ||
    toolPart.state === "error"
  ) {
    return {
      type: "error-text",
      value: toolPart.errorText ?? stringifyUnknown(toolPart.output ?? "Tool error"),
    };
  }

  return null;
}

function convertSystemMessage(message: ChatUiMessage): ProviderModelMessage[] {
  const content = message.parts.flatMap((part) => (isTextPart(part) ? [part.text] : [])).join("");
  if (content.length === 0) {
    return [];
  }

  return [
    {
      role: "system",
      content,
    },
  ];
}

function convertUserMessage(message: ChatUiMessage): ProviderModelMessage[] {
  const content: Array<
    { type: "text"; text: string } | {
      type: "file" | "image";
      mediaType: string;
      data: string;
      url: string;
      filename?: string;
      uploadId?: string;
      uploadPath?: string;
    }
  > = [];

  for (const part of message.parts) {
    if (isTextPart(part)) {
      content.push({ type: "text", text: part.text });
      continue;
    }

    const filePart = getFilePart(part);
    if (filePart) {
      content.push(filePart);
    }
  }

  if (content.length === 0) {
    return [];
  }

  return [
    {
      role: "user",
      content,
    },
  ];
}

function convertAssistantMessage(message: ChatUiMessage): ProviderModelMessage[] {
  const rawToolNamesById = buildRawToolNameMap(message.parts);
  const assistantContent: Array<
    | { type: "text"; text: string }
    | { type: "reasoning"; text: string }
    | { type: "file" | "image"; mediaType: string; data: string; filename?: string }
    | { type: "tool-call"; toolCallId: string; toolName: string; input: Record<string, unknown> }
  > = [];
  const deferredAssistantContent: typeof assistantContent = [];
  const toolResults: Array<{
    type: "tool-result";
    toolCallId: string;
    toolName: string;
    output:
      | {
        type: "json";
        value: JsonValue;
      }
      | {
        type: "error-text";
        value: string;
      };
  }> = [];
  const pendingToolCallIds = new Set<string>();
  const messages: ProviderModelMessage[] = [];

  const flushAssistantMessage = (content: typeof assistantContent) => {
    if (content.length === 0) {
      return;
    }

    messages.push({
      role: "assistant",
      content: [...content],
    });
    content.length = 0;
  };

  const flushToolMessage = () => {
    if (toolResults.length === 0) {
      return;
    }

    messages.push({
      role: "tool",
      content: [...toolResults],
    });
    toolResults.length = 0;
  };

  const pushAssistantPart = (
    part:
      | { type: "text"; text: string }
      | { type: "reasoning"; text: string }
      | { type: "file" | "image"; mediaType: string; data: string; filename?: string }
      | { type: "tool-call"; toolCallId: string; toolName: string; input: Record<string, unknown> },
  ) => {
    if (toolResults.length > 0) {
      flushToolMessage();
      flushAssistantMessage(deferredAssistantContent);
    }

    if (part.type === "tool-call") {
      assistantContent.push(part);
      pendingToolCallIds.add(part.toolCallId);
      return;
    }

    if (pendingToolCallIds.size > 0) {
      deferredAssistantContent.push(part);
      return;
    }

    assistantContent.push(part);
  };

  const pushToolResult = (part: {
    type: "tool-result";
    toolCallId: string;
    toolName: string;
    output:
      | {
        type: "json";
        value: JsonValue;
      }
      | {
        type: "error-text";
        value: string;
      };
  }) => {
    flushAssistantMessage(assistantContent);
    toolResults.push(part);
    pendingToolCallIds.delete(part.toolCallId);
  };

  for (const part of message.parts) {
    if (isTextPart(part)) {
      pushAssistantPart({ type: "text", text: part.text });
      continue;
    }

    if (isReasoningPart(part)) {
      pushAssistantPart({ type: "reasoning", text: part.text });
      continue;
    }

    const filePart = getFilePart(part);
    if (filePart) {
      pushAssistantPart(filePart);
      continue;
    }

    const toolPart = getToolPart(part);
    if (toolPart) {
      pushAssistantPart({
        type: "tool-call",
        toolCallId: toolPart.toolCallId,
        toolName: toolPart.toolName,
        input: toolPart.input,
      });

      const resultOutput = buildToolResultOutput(toolPart);
      if (resultOutput) {
        pushToolResult({
          type: "tool-result",
          toolCallId: toolPart.toolCallId,
          toolName: toolPart.toolName,
          output: resultOutput,
        });
      }
      continue;
    }

    const rawToolCall = getRawToolCallPart(part);
    if (rawToolCall) {
      pushAssistantPart({
        type: "tool-call",
        toolCallId: rawToolCall.toolCallId,
        toolName: rawToolCall.toolName,
        input: rawToolCall.input,
      });
      continue;
    }

    const rawToolResult = getRawToolResultPart(part);
    if (rawToolResult) {
      pushToolResult({
        type: "tool-result",
        toolCallId: rawToolResult.toolCallId,
        toolName: rawToolResult.toolName ?? rawToolNamesById.get(rawToolResult.toolCallId) ??
          "unknown",
        output: rawToolResult.output,
      });
    }
  }

  flushAssistantMessage(assistantContent);
  flushToolMessage();
  flushAssistantMessage(deferredAssistantContent);

  return messages;
}

export function convertUiMessagesToProviderModelMessages(
  messages: ChatUiMessage[],
): ProviderModelMessage[] {
  return messages.flatMap((message) => {
    switch (message.role) {
      case "system":
        return convertSystemMessage(message);
      case "user":
        return convertUserMessage(message);
      case "assistant":
        return convertAssistantMessage(message);
      default:
        return [];
    }
  });
}

/**
 * @deprecated Use convertUiMessagesToProviderModelMessages for provider-facing model payloads.
 */
export const convertUiMessagesToModelMessages = convertUiMessagesToProviderModelMessages;
