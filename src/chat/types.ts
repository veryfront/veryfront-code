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

export const textFileExtensions = [...NATIVE_TEXT_ATTACHMENT_EXTENSIONS, ".csv"] as const;

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

export type ChatUiMessageRole = "system" | "user" | "assistant";

export type ChatTextUiPart = {
  type: "text";
  text: string;
};

export type ChatReasoningUiPart = {
  type: "reasoning";
  text: string;
};

export type ChatStepStartUiPart = {
  type: "step-start";
};

export type ChatSourceUrlUiPart = {
  type: "source-url";
  sourceId: string;
  url: string;
  title?: string;
};

export type ChatSourceDocumentUiPart = {
  type: "source-document";
  sourceId: string;
  title: string;
  mediaType?: string;
  filename?: string;
};

export type ChatFileUiPart = {
  type: "file";
  mediaType: string;
  url: string;
  filename?: string;
};

export type FileUIPartWithUpload = ChatFileUiPart & {
  uploadId?: string;
  uploadPath?: string;
};

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

export type ChatDynamicToolUiPart = ChatToolPartBase & {
  type: "dynamic-tool";
  toolName: string;
};

export type ChatNamedToolUiPart = ChatToolPartBase & {
  type: `tool-${string}` | "tool_call";
  toolName?: string;
};

export type ChatDataUiPart = {
  type: `data-${string}`;
  data: unknown;
};

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

export interface ChatUiMessage<TMessageMetadata = ChatMessageMetadata> {
  id: string;
  role: ChatUiMessageRole;
  parts: ChatUiMessagePart[];
  metadata?: TMessageMetadata;
}

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export type ChatModelTextPart = {
  type: "text";
  text: string;
};

export type ChatModelReasoningPart = {
  type: "reasoning";
  text: string;
};

export type ChatModelFilePart = {
  type: "file" | "image";
  mediaType: string;
  data?: string;
  url?: string;
  filename?: string;
  uploadId?: string;
  uploadPath?: string;
};

export type ChatToolCallPart = {
  type: "tool-call";
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
  providerExecuted?: boolean;
};

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

export type ChatToolResultPart = {
  type: "tool-result";
  toolCallId: string;
  toolName: string;
  output: ChatToolResultOutput;
  providerOptions?: unknown;
};

export type ChatUserContentPart = ChatModelTextPart | ChatModelFilePart;
export type ChatAssistantContentPart =
  | ChatModelTextPart
  | ChatModelReasoningPart
  | ChatModelFilePart
  | ChatToolCallPart
  | ChatToolResultPart;

export type ChatSystemMessage = {
  role: "system";
  content: string;
  providerOptions?: Record<string, unknown>;
};

export type ChatUserMessage = {
  role: "user";
  content: string | ChatUserContentPart[];
};

export type ChatAssistantMessage = {
  role: "assistant";
  content: string | ChatAssistantContentPart[];
};

export type ChatToolMessage = {
  role: "tool";
  content: ChatToolResultPart[];
};

export type ProviderModelMessage =
  | ChatSystemMessage
  | ChatUserMessage
  | ChatAssistantMessage
  | ChatToolMessage;

/**
 * @deprecated Use ProviderModelMessage for provider-facing model payloads.
 */
export type ChatModelMessage = ProviderModelMessage;

export interface DurableRootRunDescriptor {
  runId: string;
  messageId: string;
  latestEventId?: number;
  latestExternalEventSequence?: number;
  parentConversationId?: string;
  parentRunId?: string;
  spawnedFromToolCallId?: string;
}

export interface ChatRuntimeOverrides {
  allowedTools?: string[];
  thinking?: false | number;
  maxSteps?: number;
}

export interface ProjectFile {
  path: string;
  content: string;
}

export interface ProjectFileListItem {
  id: string;
  path: string;
  type: string;
  size: number;
  updated_at: string;
}

export interface UploadedFileReference {
  name: string;
  mediaType: string;
  uploadId?: string;
  path?: string;
  url?: string;
  size?: number;
}

export const getChatRequestContextSchema = defineSchema((v) =>
  v.object({
    conversationId: v.string().optional(),
    projectId: v.string().nullable(),
    branchId: v.string().nullable(),
    environmentContext: v.string().optional(),
  }).strict()
);

/** @deprecated Use getChatRequestContextSchema() */
export const chatRequestContextSchema = lazySchema(getChatRequestContextSchema);

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

/** @deprecated Use getMessageMetadataSchema() */
export const messageMetadataSchema = lazySchema(getMessageMetadataSchema);

export const getChatUiMessageRoleSchema = defineSchema((v) =>
  v.enum(["system", "user", "assistant"])
);

/** @deprecated Use getChatUiMessageRoleSchema() */
export const chatUiMessageRoleSchema = lazySchema(getChatUiMessageRoleSchema);

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

/** @deprecated Use getChatToolPartStateSchema() */
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

/** @deprecated Use getChatUiMessagePartSchema() */
export const chatUiMessagePartSchema = lazySchema(getChatUiMessagePartSchema);

export const getChatUiMessageSchema = defineSchema((v) =>
  v.object({
    id: nonEmptyString(v),
    role: getChatUiMessageRoleSchema(),
    parts: v.array(getChatUiMessagePartSchema()),
    metadata: getMessageMetadataSchema().optional(),
  }).strip()
);

/** @deprecated Use getChatUiMessageSchema() */
export const chatUiMessageSchema = lazySchema(getChatUiMessageSchema);

export const getChatUiMessagesSchema = defineSchema((v) => v.array(getChatUiMessageSchema()));

/** @deprecated Use getChatUiMessagesSchema() */
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

export function isImageFile(type: string | undefined) {
  return type?.startsWith("image/") ?? false;
}

export function isValidImageFile(type: string) {
  if (type.length === 0) {
    return false;
  }

  return imageFileTypes.some((imageFileType) => imageFileType === type);
}

export function isTextPreviewFile(name: string | undefined, type: string | undefined) {
  return isTextMediaType(type) || hasExtension(name, textFileExtensions);
}

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
