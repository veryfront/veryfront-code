import type {
  ChatMessageMetadata,
  ChatMessageMetadataUsage,
  ChatUiMessageChunk,
  ChildRunAudit,
  ChildRunAuditToolCall,
  ChildRunAuditToolResult,
} from "./protocol.ts";
import { defineSchema, lazySchema } from "#veryfront/schemas/index.ts";
import type { InferSchema, SchemaValidator } from "#veryfront/extensions/schema/index.ts";

const NATIVE_TEXT_ATTACHMENT_EXTENSIONS = [
  ".txt",
  ".md",
  ".json",
  ".xml",
  ".html",
  ".css",
  ".js",
  ".mjs",
  ".cjs",
  ".ts",
  ".mts",
  ".cts",
  ".jsx",
  ".tsx",
  ".py",
  ".java",
  ".cpp",
  ".c",
  ".h",
  ".php",
  ".rb",
  ".go",
  ".rs",
  ".swift",
  ".kt",
  ".scala",
  ".sh",
  ".yaml",
  ".yml",
  ".toml",
  ".ini",
  ".cfg",
  ".conf",
  ".sql",
] as const;

/** File extensions that chat uploads can inline as text. */
export const textFileExtensions = [...NATIVE_TEXT_ATTACHMENT_EXTENSIONS, ".csv"] as const;

/** Image media types that chat uploads can display natively. */
export const imageFileTypes = [
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "image/webp",
  "image/bmp",
  "image/tiff",
] as const;

const INLINE_TEXT_MEDIA_TYPE = "text/plain";
const INLINE_BINARY_MEDIA_TYPE = "application/octet-stream";
const INLINE_PDF_MEDIA_TYPE = "application/pdf";

/** Public API contract for chat UI message role. */
export type ChatUiMessageRole = "system" | "user" | "assistant" | "tool";

/** Public API contract for chat text UI part. */
export type ChatTextUiPart = {
  type: "text";
  text: string;
};

/** Public API contract for chat reasoning UI part. */
export type ChatReasoningUiPart = {
  type: "reasoning";
  text: string;
};

/** Public API contract for chat step start UI part. */
export type ChatStepStartUiPart = {
  type: "step-start";
};

/** Public API contract for chat source URL UI part. */
export type ChatSourceUrlUiPart = {
  type: "source-url";
  sourceId: string;
  url: string;
  title?: string;
};

/** Public API contract for chat source document UI part. */
export type ChatSourceDocumentUiPart = {
  type: "source-document";
  sourceId: string;
  title: string;
  mediaType?: string;
  filename?: string;
};

/** Public API contract for chat file UI part. */
export type ChatFileUiPart = {
  type: "file";
  mediaType: string;
  url: string;
  filename?: string;
};

/** File UI part enriched with upload metadata. */
export type FileUIPartWithUpload = ChatFileUiPart & {
  uploadId?: string;
  uploadPath?: string;
};

/** State for chat tool part. */
export type ChatToolPartState =
  | "pending"
  | "input-streaming"
  | "input-available"
  | "approval-requested"
  | "approval-responded"
  | "output-available"
  | "output-error"
  | "output-denied"
  | "error"
  | "completed";

/** Public API contract for chat tool part base. */
type ChatToolPartBase = {
  toolCallId: string;
  input: unknown;
  state: ChatToolPartState;
  title?: string;
  providerExecuted?: boolean;
  callProviderMetadata?: Record<string, unknown>;
  output?: unknown;
  errorText?: string;
  approval?: {
    id: string;
  };
};

/** Tool UI part for a runtime-selected tool name. */
export type ChatDynamicToolUiPart = ChatToolPartBase & {
  type: "dynamic-tool";
  toolName: string;
};

/** Tool UI part keyed by a static tool type. */
export type ChatNamedToolUiPart = ChatToolPartBase & {
  type: `tool-${string}` | "tool_call";
  toolName?: string;
};

/** Chat UI part that carries custom data chunks. */
export type ChatDataUiPart = {
  type: `data-${string}`;
  data: unknown;
};

/** Public API contract for chat UI message part. */
export type ChatUiMessagePart =
  | ChatTextUiPart
  | ChatReasoningUiPart
  | ChatStepStartUiPart
  | ChatSourceUrlUiPart
  | ChatSourceDocumentUiPart
  | FileUIPartWithUpload
  | ChatDynamicToolUiPart
  | ChatNamedToolUiPart
  | ChatDataUiPart;

/** Message shape for chat UI. */
export interface ChatUiMessage<TMessageMetadata = ChatMessageMetadata> {
  id: string;
  role: ChatUiMessageRole;
  parts: ChatUiMessagePart[];
  metadata?: TMessageMetadata;
}

/** JSON-compatible value used in chat tool output. */
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** Provider model message part that carries text. */
export type ChatModelTextPart = {
  type: "text";
  text: string;
};

/** Provider model message part that carries reasoning text. */
export type ChatModelReasoningPart = {
  type: "reasoning";
  text: string;
};

/** Public API contract for chat model file part. */
export type ChatModelFilePart = {
  type: "file" | "image";
  mediaType: string;
  data?: string;
  url?: string;
  filename?: string;
  uploadId?: string;
  uploadPath?: string;
};

/** Provider model message part that carries a tool call. */
export type ChatToolCallPart = {
  type: "tool-call";
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
  providerExecuted?: boolean;
};

/** Output from chat tool result. */
export type ChatToolResultOutput =
  | {
    type: "json";
    value: JsonValue;
  }
  | {
    type: "text";
    value: string;
  }
  | {
    type: "error-text";
    value: string;
  };

/** Provider model message part that carries a tool result. */
export type ChatToolResultPart = {
  type: "tool-result";
  toolCallId: string;
  toolName: string;
  output: ChatToolResultOutput;
  providerOptions?: unknown;
};

/** Public API contract for chat user content part. */
export type ChatUserContentPart = ChatModelTextPart | ChatModelFilePart;
/** Public API contract for chat assistant content part. */
export type ChatAssistantContentPart =
  | ChatModelTextPart
  | ChatModelReasoningPart
  | ChatModelFilePart
  | ChatToolCallPart
  | ChatToolResultPart;

/** Message shape for chat system. */
export type ChatSystemMessage = {
  role: "system";
  content: string;
  providerOptions?: Record<string, unknown>;
};

/** Message shape for chat user. */
export type ChatUserMessage = {
  role: "user";
  content: string | ChatUserContentPart[];
};

/** Message shape for chat assistant. */
export type ChatAssistantMessage = {
  role: "assistant";
  content: string | ChatAssistantContentPart[];
};

/** Message shape for chat tool. */
export type ChatToolMessage = {
  role: "tool";
  content: ChatToolResultPart[];
};

/** Message shape for provider model. */
export type ProviderModelMessage =
  | ChatSystemMessage
  | ChatUserMessage
  | ChatAssistantMessage
  | ChatToolMessage;

/**
 * @deprecated Use ProviderModelMessage for provider-facing model payloads.
 */
/** Message shape for chat model. */
export type ChatModelMessage = ProviderModelMessage;

/** Public API contract for durable root run descriptor. */
export interface DurableRootRunDescriptor {
  runId: string;
  messageId: string;
  latestEventId?: number;
  latestExternalEventSequence?: number;
  parentConversationId?: string;
  parentRunId?: string;
  spawnedFromToolCallId?: string;
}

/** Public API contract for chat runtime overrides. */
export interface ChatRuntimeOverrides {
  allowedTools?: string[];
  thinking?: false | number;
  maxSteps?: number;
}

/** Public API contract for project file. */
export interface ProjectFile {
  path: string;
  content: string;
}

/** Public API contract for project file list item. */
export interface ProjectFileListItem {
  id: string;
  path: string;
  type: string;
  size: number;
  updated_at: string;
}

/** Public API contract for uploaded file reference. */
export interface UploadedFileReference {
  name: string;
  mediaType: string;
  uploadId?: string;
  path?: string;
  url?: string;
  size?: number;
}

/** Zod schema for get chat request context. */
export const getChatRequestContextSchema = defineSchema((v) =>
  v.object({
    conversationId: v.string().optional(),
    projectId: v.string().nullable(),
    branchId: v.string().nullable(),
    environmentContext: v.string().optional(),
  }).strict()
);

/** Schema for chat request context.
 * @deprecated Use getChatRequestContextSchema()
 */
export const chatRequestContextSchema = lazySchema(getChatRequestContextSchema);

/** Context for chat request. */
export type ChatRequestContext = InferSchema<ReturnType<typeof getChatRequestContextSchema>>;

// Helper that returns a nonEmptyString schema for reuse within defineSchema callbacks.
const nonEmptyString = (v: SchemaValidator) => v.string().min(1);

const getChildRunAuditStatusSchema = defineSchema((v) =>
  v.enum(["completed", "failed", "cancelled", "stopped"])
);

const getChildRunAuditToolCallSchema = defineSchema((v) =>
  v.object({
    toolName: v.string(),
    toolCallId: v.string(),
    input: v.unknown().optional(),
  }).strict()
);

const getChildRunAuditToolResultSchema = defineSchema((v) =>
  v.object({
    toolName: v.string(),
    toolCallId: v.string(),
    input: v.unknown(),
    output: v.unknown(),
  }).strict()
);

const getChildRunAuditSchema = defineSchema((v) =>
  v.object({
    status: getChildRunAuditStatusSchema(),
    description: v.string().optional(),
    steps: v.number().optional(),
    durationMs: v.number().optional(),
    toolCalls: v.array(getChildRunAuditToolCallSchema()).optional(),
    toolResults: v.array(getChildRunAuditToolResultSchema()).optional(),
    terminalErrorCode: v.string().nullable().optional(),
    terminalErrorMessage: v.string().nullable().optional(),
  }).strict()
);

const getMessageMetadataUsageSchema = defineSchema((v) =>
  v.object({
    inputTokens: v.number().optional(),
    outputTokens: v.number().optional(),
    reasoningTokens: v.number().optional(),
    cachedInputTokens: v.number().optional(),
  }).strict()
);

/** Zod schema for get message metadata. */
export const getMessageMetadataSchema = defineSchema((v) =>
  v.object({
    createdAt: v.string().optional(),
    isStopped: v.boolean().optional(),
    isCompleted: v.boolean().optional(),
    completedAt: v.string().optional(),
    agentId: v.string().optional(),
    agentName: v.string().optional(),
    conversationId: v.string().optional(),
    modelId: v.string().optional(),
    runId: v.string().optional(),
    streamingMessageId: v.string().optional(),
    childRunAudit: getChildRunAuditSchema().optional(),
    usage: getMessageMetadataUsageSchema().optional(),
  }).strict()
);

/** Schema for message metadata.
 * @deprecated Use getMessageMetadataSchema()
 */
export const messageMetadataSchema = lazySchema(getMessageMetadataSchema);

/** Zod schema for get chat UI message role. */
export const getChatUiMessageRoleSchema = defineSchema((v) =>
  v.enum(["system", "user", "assistant"])
);

/** Schema for chat ui message role.
 * @deprecated Use getChatUiMessageRoleSchema()
 */
export const chatUiMessageRoleSchema = lazySchema(getChatUiMessageRoleSchema);

/** Zod schema for get chat tool part state. */
export const getChatToolPartStateSchema = defineSchema((v) =>
  v.enum([
    "pending",
    "input-streaming",
    "input-available",
    "approval-requested",
    "approval-responded",
    "output-available",
    "output-error",
    "output-denied",
    "error",
    "completed",
  ])
);

/** Schema for chat tool part state.
 * @deprecated Use getChatToolPartStateSchema()
 */
export const chatToolPartStateSchema = lazySchema(getChatToolPartStateSchema);

const getToolApprovalSchema = defineSchema((v) =>
  v.object({
    id: nonEmptyString(v),
  }).strict()
);

const getToolPartBaseSchema = defineSchema((v) =>
  v.object({
    toolCallId: nonEmptyString(v),
    input: v.unknown(),
    state: getChatToolPartStateSchema(),
    title: nonEmptyString(v).optional(),
    providerExecuted: v.boolean().optional(),
    callProviderMetadata: v.record(v.string(), v.unknown()).optional(),
    output: v.unknown().optional(),
    errorText: nonEmptyString(v).optional(),
    approval: getToolApprovalSchema().optional(),
  }).strip()
);

const getChatTextUiPartSchema = defineSchema((v) =>
  v.object({
    type: v.literal("text"),
    text: v.string(),
  }).strip()
);

const getChatReasoningUiPartSchema = defineSchema((v) =>
  v.object({
    type: v.literal("reasoning"),
    text: v.string(),
  }).strip()
);

const getChatStepStartUiPartSchema = defineSchema((v) =>
  v.object({
    type: v.literal("step-start"),
  }).strip()
);

const getChatSourceUrlUiPartSchema = defineSchema((v) =>
  v.object({
    type: v.literal("source-url"),
    sourceId: nonEmptyString(v),
    url: nonEmptyString(v),
    title: v.string().optional(),
  }).strip()
);

const getChatSourceDocumentUiPartSchema = defineSchema((v) =>
  v.object({
    type: v.literal("source-document"),
    sourceId: nonEmptyString(v),
    title: nonEmptyString(v),
    mediaType: nonEmptyString(v).optional(),
    filename: nonEmptyString(v).optional(),
  }).strip()
);

const getFileUiPartWithUploadSchema = defineSchema((v) =>
  v.object({
    type: v.literal("file"),
    mediaType: nonEmptyString(v),
    url: nonEmptyString(v),
    filename: nonEmptyString(v).optional(),
    uploadId: nonEmptyString(v).optional(),
    uploadPath: nonEmptyString(v).optional(),
  }).strip()
);

const getChatDynamicToolUiPartSchema = defineSchema((v) =>
  getToolPartBaseSchema().extend({
    type: v.literal("dynamic-tool"),
    toolName: nonEmptyString(v),
  })
);

const getChatNamedToolTypeSchema = defineSchema((v) =>
  v.custom<ChatNamedToolUiPart["type"]>(
    (value) => typeof value === "string" && (value === "tool_call" || /^tool-.+$/u.test(value)),
  )
);

const getChatNamedToolUiPartSchema = defineSchema((v) =>
  getToolPartBaseSchema().extend({
    type: getChatNamedToolTypeSchema(),
    toolName: nonEmptyString(v).optional(),
  })
);

const getChatDataUiPartTypeSchema = defineSchema((v) =>
  v.custom<ChatDataUiPart["type"]>(
    (value) => typeof value === "string" && /^data-.+$/u.test(value),
  )
);

const getChatDataUiPartSchema = defineSchema((v) =>
  v.object({
    type: getChatDataUiPartTypeSchema(),
    data: v.unknown(),
  }).strip()
);

/** Zod schema for get chat UI message part. */
export const getChatUiMessagePartSchema = defineSchema((v) =>
  v.union([
    getChatTextUiPartSchema(),
    getChatReasoningUiPartSchema(),
    getChatStepStartUiPartSchema(),
    getChatSourceUrlUiPartSchema(),
    getChatSourceDocumentUiPartSchema(),
    getFileUiPartWithUploadSchema(),
    getChatDynamicToolUiPartSchema(),
    getChatNamedToolUiPartSchema(),
    getChatDataUiPartSchema(),
  ])
);

/** Schema for chat ui message part.
 * @deprecated Use getChatUiMessagePartSchema()
 */
export const chatUiMessagePartSchema = lazySchema(getChatUiMessagePartSchema);

/** Zod schema for get chat UI message. */
export const getChatUiMessageSchema = defineSchema((v) =>
  v.object({
    id: nonEmptyString(v),
    role: getChatUiMessageRoleSchema(),
    parts: v.array(getChatUiMessagePartSchema()),
    metadata: getMessageMetadataSchema().optional(),
  }).strip()
);

/** Schema for chat ui message.
 * @deprecated Use getChatUiMessageSchema()
 */
export const chatUiMessageSchema = lazySchema(getChatUiMessageSchema);

/** Zod schema for get chat UI messages. */
export const getChatUiMessagesSchema = defineSchema((v) => v.array(getChatUiMessageSchema()));

/** Schema for chat ui messages.
 * @deprecated Use getChatUiMessagesSchema()
 */
export const chatUiMessagesSchema = lazySchema(getChatUiMessagesSchema);

function hasExtension(filename: string | undefined, extensions: readonly string[]) {
  const normalizedFilename = filename?.toLowerCase() ?? "";
  return extensions.some((extension) => normalizedFilename.endsWith(extension));
}

function isNativeTextAttachmentFile(filename: string | undefined) {
  return hasExtension(filename, NATIVE_TEXT_ATTACHMENT_EXTENSIONS);
}

function preferNativeTextAttachmentMediaType(
  filename: string | undefined,
  fallbackMediaType: string,
) {
  return isNativeTextAttachmentFile(filename) ? INLINE_TEXT_MEDIA_TYPE : fallbackMediaType;
}

function isTextMediaType(type: string | undefined) {
  return type?.startsWith("text/") ?? false;
}

function isInlinePreviewMediaType(mediaType: string) {
  return isTextMediaType(mediaType) || isImageFile(mediaType) ||
    mediaType === INLINE_PDF_MEDIA_TYPE;
}

/** Check whether a file is an image. */
export function isImageFile(type: string | undefined) {
  return type?.startsWith("image/") ?? false;
}

/** Check whether a file is a supported image upload. */
export function isValidImageFile(type: string) {
  if (type.length === 0) {
    return false;
  }

  return imageFileTypes.some((imageFileType) => imageFileType === type);
}

/** Check whether a file supports text preview. */
export function isTextPreviewFile(name: string | undefined, type: string | undefined) {
  return isTextMediaType(type) || hasExtension(name, textFileExtensions);
}

/** Normalizes inline attachment media type. */
export function normalizeInlineAttachmentMediaType(
  filename: string | undefined,
  mediaType: string | undefined,
) {
  if (!mediaType) {
    return preferNativeTextAttachmentMediaType(filename, INLINE_BINARY_MEDIA_TYPE);
  }

  if (isInlinePreviewMediaType(mediaType)) {
    return mediaType;
  }

  return preferNativeTextAttachmentMediaType(filename, mediaType);
}

function escapeXmlAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(
    />/g,
    "&gt;",
  );
}

/** Builds data file annotation. */
export function buildDataFileAnnotation(refs: UploadedFileReference[]): string {
  if (refs.length === 0) return "";

  const fileTags = refs
    .map((ref) => {
      const attrs = [`name="${escapeXmlAttr(ref.name)}"`];

      if (ref.uploadId) attrs.push(`upload_id="${escapeXmlAttr(ref.uploadId)}"`);
      if (ref.path) attrs.push(`path="${escapeXmlAttr(ref.path)}"`);
      if (typeof ref.size === "number") attrs.push(`size="${ref.size}"`);
      if (ref.url) attrs.push(`url="${escapeXmlAttr(ref.url)}"`);

      attrs.push(`type="${escapeXmlAttr(ref.mediaType)}"`);

      return `<file ${attrs.join(" ")} />`;
    })
    .join("\n");

  return `\n\n<uploaded_files>\n${fileTags}\n</uploaded_files>`;
}

export type {
  ChatMessageMetadata,
  ChatMessageMetadata as MessageMetadata,
  ChatMessageMetadataUsage,
  ChatUiMessageChunk,
  ChildRunAudit,
  ChildRunAuditToolCall,
  ChildRunAuditToolResult,
};
