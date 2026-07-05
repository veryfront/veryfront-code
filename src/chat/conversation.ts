import { defineSchema } from "#veryfront/schemas/index.ts";
import type { InferSchema } from "#veryfront/extensions/schema/index.ts";
import type {
  ChatToolResultPart,
  ChatUiMessage,
  ChatUiMessagePart,
  ProviderModelMessage,
} from "./types.ts";

const PROVIDER_MODEL_MESSAGE_SOURCE_ID = Symbol.for("veryfront.providerModelMessageSourceId");

/** Provider model message plus local-only source metadata. */
export type ProviderModelMessageWithSourceId = ProviderModelMessage & {
  [PROVIDER_MODEL_MESSAGE_SOURCE_ID]?: string;
};

/** Read the local-only source UI message id attached during provider conversion. */
export function getProviderModelMessageSourceId(message: ProviderModelMessage): string | undefined {
  return (message as ProviderModelMessageWithSourceId)[PROVIDER_MODEL_MESSAGE_SOURCE_ID];
}

/** Attach local-only source UI message id metadata to a provider message. */
export function withProviderModelMessageSourceId(
  message: ProviderModelMessage,
  sourceId: string,
): ProviderModelMessage {
  Object.defineProperty(message, PROVIDER_MODEL_MESSAGE_SOURCE_ID, {
    value: sourceId,
    configurable: true,
    enumerable: false,
    writable: true,
  });
  return message;
}

/** Copy local-only source UI message id metadata when a provider message is cloned. */
export function copyProviderModelMessageSourceId<T extends ProviderModelMessage>(
  source: ProviderModelMessage,
  target: T,
): T {
  const sourceId = getProviderModelMessageSourceId(source);
  return sourceId ? withProviderModelMessageSourceId(target, sourceId) as T : target;
}

/** Zod schema for get message part. */
export const getMessagePartSchema = defineSchema((v) =>
  v.discriminatedUnion("type", [
    v.object({ type: v.literal("text"), text: v.string() }),
    v.object({
      type: v.literal("image"),
      upload_id: v.string().uuid(),
      media_type: v.string(),
      url: v.string().optional(),
    }),
    v.object({
      type: v.literal("file"),
      upload_id: v.string().uuid(),
      media_type: v.string(),
      filename: v.string().optional(),
      url: v.string().optional(),
    }),
    v.object({
      type: v.literal("tool_call"),
      id: v.string(),
      name: v.string(),
      input: v.record(v.string(), v.unknown()),
      state: v.enum(["streaming", "pending", "completed", "error"]),
    }),
    v.object({
      type: v.literal("tool_result"),
      tool_call_id: v.string(),
      output: v.unknown(),
      is_error: v.boolean().optional(),
    }),
    v.object({
      type: v.literal("reasoning"),
      text: v.string().optional(),
      signature: v.string().optional(),
      redactedData: v.string().optional(),
    }),
    v.object({
      type: v.literal("citation"),
      source_id: v.string(),
      url: v.string().optional(),
      title: v.string().optional(),
      quote: v.string().optional(),
    }),
    v.object({ type: v.literal("step_start") }),
    v.object({
      type: v.literal("error"),
      code: v.string(),
      message: v.string(),
    }),
    v.object({ type: v.literal("data"), name: v.string(), value: v.unknown() }),
  ])
);

/** Public API contract for message part. */
export type MessagePart = InferSchema<ReturnType<typeof getMessagePartSchema>>;

/** Zod schema for get conversation type. */
export const getConversationTypeSchema = defineSchema((v) =>
  v.enum(["chat", "agent_task", "support", "channel", "project_agent"])
);
/** Public API contract for conversation type. */
export type ConversationType = InferSchema<ReturnType<typeof getConversationTypeSchema>>;

/** Zod schema for get message status. */
export const getMessageStatusSchema = defineSchema((v) =>
  v.enum(["pending", "streaming", "completed", "error", "failed", "cancelled", "stopped"])
);
/** Public API contract for message status. */
export type MessageStatus = InferSchema<ReturnType<typeof getMessageStatusSchema>>;

/** Zod schema for get API conversation. */
export const getApiConversationSchema = defineSchema((v) =>
  v.object({
    id: v.string(),
    projectId: v.string().nullable().optional(),
    type: getConversationTypeSchema(),
    title: v.string().nullable().optional(),
    status: v.enum(["active", "archived", "deleted"]),
    summary: v.string().nullable().optional(),
    currentNode: v.string().nullable().optional(),
    messageCount: v.number(),
    lastMessageAt: v.string().nullable().optional(),
    metadata: v.record(v.string(), v.unknown()).nullable().optional(),
    createdBy: v.string(),
    archivedAt: v.string().nullable().optional(),
    createdAt: v.string(),
    updatedAt: v.string(),
  })
);

/** Public API contract for API conversation. */
export type ApiConversation = InferSchema<ReturnType<typeof getApiConversationSchema>>;

/** Zod schema for get API message. */
export const getApiMessageSchema = defineSchema((v) =>
  v.object({
    id: v.string(),
    conversationId: v.string(),
    parentId: v.string().nullable(),
    seq: v.number(),
    role: v.enum(["user", "assistant", "tool"]),
    parts: v.array(getMessagePartSchema()),
    status: getMessageStatusSchema(),
    model: v.string().nullable(),
    tokenUsage: v.object({ input: v.number(), output: v.number() }).nullable(),
    finishReason: v.string().nullable(),
    costCredits: v.string().nullable().optional(),
    createdBy: v.string().nullable(),
    editedAt: v.string().nullable().optional(),
    idempotencyKey: v.string().nullable().optional(),
    metadata: v.record(v.string(), v.unknown()).nullable(),
    createdAt: v.string(),
    updatedAt: v.string().nullable(),
  })
);

/** Message shape for API. */
export type ApiMessage = InferSchema<ReturnType<typeof getApiMessageSchema>>;

/** Public API contract for tool call like. */
export interface ToolCallLike {
  type: "tool-call";
  toolCallId: string;
  toolName: string;
  input: unknown;
  providerExecuted?: boolean;
}

/** Public API contract for tool result like. */
export interface ToolResultLike {
  type: "tool-result";
  toolCallId: string;
  toolName: string;
  output: unknown;
  providerOptions?: unknown;
}

/** Text-like provider message part. */
export interface TextPartLike {
  type: "text";
  text: string;
}

/** Reasoning-like provider message part. */
export interface ReasoningPartLike {
  type: "reasoning";
  text?: string;
  signature?: string;
  redactedData?: string;
}

/** Chat UI tool part with a call ID and state. */
type ToolUiPart = Extract<ChatUiMessagePart, { toolCallId: string; state: string }>;
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

const PROVIDER_NATIVE_WEB_TOOL_NAMES = new Set(["web_fetch", "web_search"]);

/** Shared UUID pattern value. */
export const UUID_PATTERN =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i;

/** Check whether a value is a UUID. */
export function isUuid(value: string | null | undefined): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

/** Extract upload ID. */
export function extractUploadId(url: string): string | null {
  const match = url.match(UUID_PATTERN);
  return match ? match[0] : null;
}

/** State for map tool. */
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

/** Record shape for is. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Return string field. */
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

/** Stringify unknown helper. */
export function stringifyUnknown(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    const serialized = JSON.stringify(value);
    return serialized ?? String(value);
  } catch {
    return String(value);
  }
}

/** Check whether a chat part is a custom data part. */
export function isDataUiPart(
  part: ChatUiMessagePart,
): part is ChatUiMessagePart & { type: `data-${string}`; data: unknown } {
  return part.type.startsWith("data-") && "data" in part;
}

/** Check whether a chat part is a tool UI part. */
export function isToolUiPart(part: ChatUiMessagePart): part is ToolUiPart {
  return (
    (part.type === "dynamic-tool" || part.type === "tool_call" ||
      part.type.startsWith("tool-")) &&
    typeof getOptionalStringField(part, "toolCallId") === "string" &&
    typeof getOptionalStringField(part, "state") === "string"
  );
}

/** Return UI tool name. */
export function getUiToolName(part: ToolUiPart): string | undefined {
  const explicitToolName = getOptionalStringField(part, "toolName");
  if (explicitToolName) {
    return explicitToolName;
  }

  return part.type.startsWith("tool-") ? part.type.replace(/^tool-/, "") : undefined;
}

function isProviderOwnedInputAvailableTool(input: {
  toolName?: string;
  state: string;
  providerExecuted?: unknown;
}): boolean {
  if (input.state !== "input-available") {
    return false;
  }

  return input.providerExecuted === true ||
    (typeof input.toolName === "string" && PROVIDER_NATIVE_WEB_TOOL_NAMES.has(input.toolName));
}

/** Push tool parts. */
export function pushToolParts(
  parts: MessagePart[],
  toolName: string,
  toolCallId: string,
  state: string,
  part: {
    input?: unknown;
    output?: unknown;
    errorText?: unknown;
    providerExecuted?: unknown;
  },
): void {
  const input = toRecord(part.input);
  const isErroredState = state === "output-error" || state === "error" || state === "output-denied";
  const isProviderOwnedAvailable = isProviderOwnedInputAvailableTool({
    toolName,
    state,
    providerExecuted: part.providerExecuted,
  });
  const hasResultState = state === "output-available" || state === "completed" ||
    isErroredState || isProviderOwnedAvailable;

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
      : isProviderOwnedAvailable
      ? null
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

/** Message shape for to conversation parts from UI. */
export function toConversationPartsFromUiMessage(message: ChatUiMessage): MessagePart[] {
  const parts: MessagePart[] = [];

  for (const part of message.parts) {
    if (part.type === "text") {
      parts.push({ type: "text", text: part.text });
      continue;
    }

    if (part.type === "reasoning") {
      parts.push({
        type: "reasoning",
        text: part.text,
        ...(part.signature ? { signature: part.signature } : {}),
        ...(part.redactedData ? { redactedData: part.redactedData } : {}),
      });
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

  return parts.filter((part) => getMessagePartSchema().safeParse(part).success);
}

function isToolComplete(part: ToolUiPart): boolean {
  if (
    isProviderOwnedInputAvailableTool({
      toolName: getUiToolName(part),
      state: part.state,
      providerExecuted: part.providerExecuted,
    })
  ) {
    return true;
  }

  return part.state === "output-available" || part.state === "output-error" ||
    part.state === "output-denied" || part.state === "completed" ||
    part.state === "error";
}

/** Check whether incomplete tool parts is present. */
export function hasIncompleteToolParts(message: ChatUiMessage): boolean {
  return message.parts.some((part) => isToolUiPart(part) && !isToolComplete(part));
}

/** Mark incomplete tool parts as stopped. */
export function markIncompleteToolPartsAsStopped(message: ChatUiMessage): ChatUiMessage {
  return markIncompleteToolPartsAsErrored(message, "Stopped by user");
}

/** Mark incomplete tool parts as errored. */
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

/** Check whether a value is a tool-call part. */
export function isToolCallPart(value: unknown): value is ToolCallLike {
  return (
    isRecord(value) &&
    value.type === "tool-call" &&
    typeof value.toolCallId === "string" &&
    typeof value.toolName === "string"
  );
}

/** Check whether a value is a tool-result part. */
export function isToolResultPart(value: unknown): value is ToolResultLike {
  return (
    isRecord(value) &&
    value.type === "tool-result" &&
    typeof value.toolCallId === "string" &&
    typeof value.toolName === "string"
  );
}

/** Check whether a value is a text part. */
export function isTextPart(value: unknown): value is TextPartLike {
  return isRecord(value) && value.type === "text" && typeof value.text === "string";
}

/** Check whether a value is a reasoning part. */
export function isReasoningPart(value: unknown): value is ReasoningPartLike {
  return isRecord(value) && value.type === "reasoning" &&
    (typeof value.text === "string" ||
      typeof value.signature === "string" ||
      typeof value.redactedData === "string");
}

/** Message shape for extract text from. */
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
    | { type: "reasoning"; text?: string; signature?: string; redactedData?: string }
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
      | { type: "reasoning"; text?: string; signature?: string; redactedData?: string }
      | { type: "file" | "image"; mediaType: string; data: string; filename?: string }
      | { type: "tool-call"; toolCallId: string; toolName: string; input: Record<string, unknown> },
  ) => {
    if (part.type === "tool-call") {
      if (deferredAssistantContent.length > 0) {
        flushAssistantMessage(assistantContent);
        flushToolMessage();
        flushAssistantMessage(deferredAssistantContent);
      }

      assistantContent.push(part);
      pendingToolCallIds.add(part.toolCallId);
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
    toolResults.push(part);
    pendingToolCallIds.delete(part.toolCallId);
  };

  for (const part of message.parts) {
    if (isTextPart(part)) {
      pushAssistantPart({ type: "text", text: part.text });
      continue;
    }

    if (isReasoningPart(part)) {
      pushAssistantPart({
        type: "reasoning",
        text: part.text,
        ...(typeof part.signature === "string" ? { signature: part.signature } : {}),
        ...(typeof part.redactedData === "string" ? { redactedData: part.redactedData } : {}),
      });
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

function convertToolMessage(message: ChatUiMessage): ProviderModelMessage[] {
  const rawToolNameMap = buildRawToolNameMap(message.parts);
  const toolResults: ChatToolResultPart[] = [];

  for (const part of message.parts) {
    const rawResult = getRawToolResultPart(part);
    if (!rawResult) {
      continue;
    }

    toolResults.push({
      type: "tool-result",
      toolCallId: rawResult.toolCallId,
      toolName: rawResult.toolName ?? rawToolNameMap.get(rawResult.toolCallId) ?? "unknown",
      output: rawResult.output,
    });
  }

  if (toolResults.length === 0) {
    return [];
  }

  return [{ role: "tool", content: toolResults }];
}

/** Convert UI messages to provider model messages. */
export function convertUiMessagesToProviderModelMessages(
  messages: ChatUiMessage[],
): ProviderModelMessage[] {
  const providerMessages: ProviderModelMessage[] = [];

  for (const message of messages) {
    const converted = (() => {
      switch (message.role) {
        case "system":
          return convertSystemMessage(message);
        case "user":
          return convertUserMessage(message);
        case "assistant":
          return convertAssistantMessage(message);
        case "tool":
          return convertToolMessage(message);
        default:
          return [];
      }
    })();

    for (const rawProviderMessage of converted) {
      const providerMessage = withProviderModelMessageSourceId(rawProviderMessage, message.id);
      const previous = providerMessages.at(-1);
      if (previous?.role === "tool" && providerMessage.role === "tool") {
        providerMessages[providerMessages.length - 1] = withProviderModelMessageSourceId({
          role: "tool",
          content: [...previous.content, ...providerMessage.content],
        }, getProviderModelMessageSourceId(previous) ?? message.id);
        continue;
      }

      providerMessages.push(providerMessage);
    }
  }

  return providerMessages;
}
