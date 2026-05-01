import type {
  ChatMessageMetadata,
  ChatMessageMetadataUsage,
  ChatUiMessageChunk,
  ChildRunAudit,
  ChildRunAuditToolCall,
  ChildRunAuditToolResult,
} from "./protocol.ts";
import { z } from "zod";

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

export const chatRequestContextSchema = z
  .object({
    conversationId: z.string().optional(),
    projectId: z.string().nullable(),
    branchId: z.string().nullable(),
    environmentContext: z.string().optional(),
  })
  .strict();

export type ChatRequestContext = z.infer<typeof chatRequestContextSchema>;

const childRunAuditStatusSchema: z.ZodType<ChildRunAudit["status"]> = z.enum([
  "completed",
  "failed",
  "cancelled",
  "stopped",
]);

const childRunAuditToolCallSchema: z.ZodType<ChildRunAuditToolCall> = z
  .object({
    toolName: z.string(),
    toolCallId: z.string(),
    input: z.unknown().optional(),
  })
  .strict();

const childRunAuditToolResultSchema: z.ZodType<ChildRunAuditToolResult> = z
  .object({
    toolName: z.string(),
    toolCallId: z.string(),
    input: z.unknown(),
    output: z.unknown(),
  })
  .strict();

const childRunAuditSchema: z.ZodType<ChildRunAudit> = z
  .object({
    status: childRunAuditStatusSchema,
    description: z.string().optional(),
    steps: z.number().optional(),
    durationMs: z.number().optional(),
    toolCalls: z.array(childRunAuditToolCallSchema).optional(),
    toolResults: z.array(childRunAuditToolResultSchema).optional(),
    terminalErrorCode: z.string().nullable().optional(),
    terminalErrorMessage: z.string().nullable().optional(),
  })
  .strict();

const messageMetadataUsageSchema: z.ZodType<ChatMessageMetadataUsage> = z
  .object({
    inputTokens: z.number().optional(),
    outputTokens: z.number().optional(),
    reasoningTokens: z.number().optional(),
    cachedInputTokens: z.number().optional(),
  })
  .strict();

export const messageMetadataSchema: z.ZodType<ChatMessageMetadata> = z
  .object({
    createdAt: z.string().optional(),
    isStopped: z.boolean().optional(),
    isCompleted: z.boolean().optional(),
    completedAt: z.string().optional(),
    agentId: z.string().optional(),
    agentName: z.string().optional(),
    conversationId: z.string().optional(),
    modelId: z.string().optional(),
    runId: z.string().optional(),
    streamingMessageId: z.string().optional(),
    childRunAudit: childRunAuditSchema.optional(),
    usage: messageMetadataUsageSchema.optional(),
  })
  .strict();

const nonEmptyStringSchema = z.string().min(1);

export const chatUiMessageRoleSchema: z.ZodType<ChatUiMessageRole> = z.enum([
  "system",
  "user",
  "assistant",
]);

export const chatToolPartStateSchema: z.ZodType<ChatToolPartState> = z.enum([
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
]);

const toolApprovalSchema = z
  .object({
    id: nonEmptyStringSchema,
  })
  .strict();

const toolPartBaseSchema = z
  .object({
    toolCallId: nonEmptyStringSchema,
    input: z.unknown(),
    state: chatToolPartStateSchema,
    title: nonEmptyStringSchema.optional(),
    providerExecuted: z.boolean().optional(),
    callProviderMetadata: z.record(z.string(), z.unknown()).optional(),
    output: z.unknown().optional(),
    errorText: nonEmptyStringSchema.optional(),
    approval: toolApprovalSchema.optional(),
  })
  .strip();

const chatTextUiPartSchema: z.ZodType<ChatTextUiPart> = z
  .object({
    type: z.literal("text"),
    text: z.string(),
  })
  .strip();

const chatReasoningUiPartSchema: z.ZodType<ChatReasoningUiPart> = z
  .object({
    type: z.literal("reasoning"),
    text: z.string(),
  })
  .strip();

const chatStepStartUiPartSchema: z.ZodType<ChatStepStartUiPart> = z
  .object({
    type: z.literal("step-start"),
  })
  .strip();

const chatSourceUrlUiPartSchema: z.ZodType<ChatSourceUrlUiPart> = z
  .object({
    type: z.literal("source-url"),
    sourceId: nonEmptyStringSchema,
    url: nonEmptyStringSchema,
    title: z.string().optional(),
  })
  .strip();

const chatSourceDocumentUiPartSchema: z.ZodType<ChatSourceDocumentUiPart> = z
  .object({
    type: z.literal("source-document"),
    sourceId: nonEmptyStringSchema,
    title: nonEmptyStringSchema,
    mediaType: nonEmptyStringSchema.optional(),
    filename: nonEmptyStringSchema.optional(),
  })
  .strip();

const chatFileUiPartBaseSchema = z
  .object({
    type: z.literal("file"),
    mediaType: nonEmptyStringSchema,
    url: nonEmptyStringSchema,
    filename: nonEmptyStringSchema.optional(),
  })
  .strip();

const fileUiPartWithUploadSchema: z.ZodType<FileUIPartWithUpload> = chatFileUiPartBaseSchema.extend(
  {
    uploadId: nonEmptyStringSchema.optional(),
    uploadPath: nonEmptyStringSchema.optional(),
  },
);

const chatDynamicToolUiPartSchema: z.ZodType<ChatDynamicToolUiPart> = toolPartBaseSchema.extend({
  type: z.literal("dynamic-tool"),
  toolName: nonEmptyStringSchema,
});

const chatNamedToolTypeSchema: z.ZodType<ChatNamedToolUiPart["type"]> = z.custom<
  ChatNamedToolUiPart["type"]
>((value) => typeof value === "string" && (value === "tool_call" || /^tool-.+$/u.test(value)));

const chatNamedToolUiPartSchema: z.ZodType<ChatNamedToolUiPart> = toolPartBaseSchema.extend({
  type: chatNamedToolTypeSchema,
  toolName: nonEmptyStringSchema.optional(),
});

const chatDataUiPartTypeSchema: z.ZodType<ChatDataUiPart["type"]> = z.custom<
  ChatDataUiPart["type"]
>((value) => typeof value === "string" && /^data-.+$/u.test(value));

const chatDataUiPartSchema: z.ZodType<ChatDataUiPart> = z
  .object({
    type: chatDataUiPartTypeSchema,
    data: z.unknown(),
  })
  .strip();

export const chatUiMessagePartSchema: z.ZodType<ChatUiMessagePart> = z.union([
  chatTextUiPartSchema,
  chatReasoningUiPartSchema,
  chatStepStartUiPartSchema,
  chatSourceUrlUiPartSchema,
  chatSourceDocumentUiPartSchema,
  fileUiPartWithUploadSchema,
  chatDynamicToolUiPartSchema,
  chatNamedToolUiPartSchema,
  chatDataUiPartSchema,
]);

export const chatUiMessageSchema: z.ZodType<ChatUiMessage> = z
  .object({
    id: nonEmptyStringSchema,
    role: chatUiMessageRoleSchema,
    parts: z.array(chatUiMessagePartSchema),
    metadata: messageMetadataSchema.optional(),
  })
  .strip();

export const chatUiMessagesSchema = z.array(chatUiMessageSchema);

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
