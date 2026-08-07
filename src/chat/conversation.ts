import { defineSchema } from "#veryfront/schemas/index.ts";
import type { InferSchema } from "#veryfront/extensions/schema/index.ts";
import type { ChatUiMessage, ChatUiMessagePart, ProviderModelMessage } from "./types.ts";
import { getOptionalStringField, isRecord, toRecord } from "./part-field-access.ts";
import { isTextPart } from "./message-part-parsing.ts";

export { getStringField, isRecord, stringifyUnknown } from "./part-field-access.ts";
export type { JsonValue } from "./part-field-access.ts";
export { isReasoningPart, isTextPart } from "./message-part-parsing.ts";

const PROVIDER_MODEL_MESSAGE_SOURCE_ID = Symbol.for("veryfront.providerModelMessageSourceId");
const UPLOAD_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

const getUploadIdSchema = defineSchema((v) => v.string().min(1).max(128).regex(UPLOAD_ID_PATTERN));

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
      upload_id: getUploadIdSchema(),
      media_type: v.string(),
      url: v.string().optional(),
    }),
    v.object({
      type: v.literal("file"),
      upload_id: getUploadIdSchema(),
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
    v.object({
      type: v.literal("source_document"),
      source_id: v.string(),
      media_type: v.string(),
      title: v.string().optional(),
      filename: v.string().optional(),
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

/** Chat UI tool part with a call ID and state. */
type ToolUiPart = Extract<ChatUiMessagePart, { toolCallId: string; state: string }>;
/** Shared UUID pattern value. */
export const UUID_PATTERN =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i;

/** Check whether a value is a UUID. */
export function isUuid(value: string | null | undefined): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

/** Extract upload ID. */
export function extractUploadId(url: string): string | null {
  try {
    const parsed = new URL(url, "https://veryfront.invalid");
    const queryId = parsed.searchParams.get("id");
    if (queryId && UPLOAD_ID_PATTERN.test(queryId)) {
      return queryId;
    }
  } catch {
    // Fall through to legacy UUID extraction for malformed or opaque URLs.
  }

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
  state: string;
  providerExecuted?: unknown;
}): boolean {
  if (input.state !== "input-available") {
    return false;
  }

  return input.providerExecuted === true;
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
  const uploadId = part.uploadId && UPLOAD_ID_PATTERN.test(part.uploadId)
    ? part.uploadId
    : extractUploadId(part.url);
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
    ...(part.filename ? { filename: part.filename } : {}),
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
      if (!part.mediaType) {
        parts.push({
          type: "citation",
          source_id: part.sourceId,
          title: part.title,
        });
        continue;
      }

      parts.push({
        type: "source_document",
        source_id: part.sourceId,
        media_type: part.mediaType,
        title: part.title,
        ...(part.filename ? { filename: part.filename } : {}),
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
