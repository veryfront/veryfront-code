import { getProviderModelMessageSourceId, isRecord } from "#veryfront/chat/conversation.ts";
import {
  buildDataFileAnnotation,
  type ChatModelFilePart,
  type ChatToolResultPart,
  type ChatUserContentPart,
  type ProviderModelMessage,
  type UploadedFileReference,
} from "../../chat/types.ts";
import { toChildRunToolInputRecord } from "../child-run/execution-support.ts";

type StructuredProviderPart = Exclude<ProviderModelMessage["content"], string>[number];

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

type AgentRuntimeMessageLikePart =
  | { type: "text"; text: string }
  | { type: "reasoning"; text?: string; signature?: string; redactedData?: string }
  | {
    type: string;
    toolCallId: string;
    toolName: string;
    args: Record<string, unknown>;
  }
  | {
    type: string;
    toolCallId: string;
    toolName: string;
    input: Record<string, unknown>;
  }
  | {
    type: "tool_call";
    id?: string;
    name?: string;
    tool_call_id?: string;
    tool_name?: string;
    toolCallId?: string;
    toolName?: string;
    input?: Record<string, unknown>;
    args?: Record<string, unknown>;
  }
  | {
    type: "tool-result";
    toolCallId: string;
    toolName: string;
    result?: unknown;
  }
  | {
    type: "tool-result";
    toolCallId: string;
    toolName: string;
    output: unknown;
  }
  | {
    type: "tool_result";
    tool_call_id?: string;
    tool_name?: string;
    toolCallId?: string;
    toolName?: string;
    result?: unknown;
    output?: unknown;
  }
  | { type: "image"; url: string; mediaType: string }
  | { type: "file"; url: string; mediaType: string };

/** Public API contract for agent runtime message part. */
export type AgentRuntimeMessagePart =
  | { type: "text"; text: string }
  | { type: "reasoning"; text?: string; signature?: string; redactedData?: string }
  | {
    type: string;
    toolCallId: string;
    toolName: string;
    args: Record<string, unknown>;
  }
  | {
    type: "tool-result";
    toolCallId: string;
    toolName: string;
    result: unknown;
  }
  | { type: "image"; url: string; mediaType: string }
  | { type: "file"; url: string; mediaType: string };

/** Message shape for agent runtime. */
export interface AgentRuntimeMessage {
  id: string;
  role: ProviderModelMessage["role"];
  parts: AgentRuntimeMessagePart[];
  timestamp: number;
}

interface AgentRuntimeProviderContentParts {
  textParts: ProviderTextPart[];
  reasoningParts: ProviderReasoningPart[];
  toolCallParts: ProviderToolCallPart[];
  toolResultParts: ChatToolResultPart[];
  fileParts: ChatModelFilePart[];
}

type ProviderTextPart = { type: "text"; text: string };
type ProviderReasoningPart = {
  type: "reasoning";
  text?: string;
  signature?: string;
  redactedData?: string;
};

type ProviderToolCallPart = {
  type: "tool-call";
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
};

/** Error shape for agent runtime message conversion. */
export class AgentRuntimeMessageConversionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentRuntimeMessageConversionError";
  }
}

function hasTextContent(text: string): boolean {
  return text.trim().length > 0;
}

function getOptionalStringField(part: unknown, key: string): string | undefined {
  if (!isRecord(part)) {
    return undefined;
  }

  const value = part[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function createAgentRuntimeMessageId(message: ProviderModelMessage, index: number): string {
  return getProviderModelMessageSourceId(message) ?? `agent-runtime-${message.role}-${index + 1}`;
}

function createTextAgentRuntimePart(text: string): AgentRuntimeMessagePart | null {
  return hasTextContent(text) ? { type: "text", text } : null;
}

function toNativeFilePart(
  type: "image" | "file",
  part: unknown,
): { type: "image"; url: string; mediaType: string } | {
  type: "file";
  url: string;
  mediaType: string;
} | null {
  const url = getOptionalStringField(part, "url");
  const mediaType = getOptionalStringField(part, "mediaType");
  // `data:` URLs (inline base64) are kept: guest / no-project attachments ride
  // inline so the model sees them without a fetchable upload URL.
  if (!url || !mediaType) {
    return null;
  }
  return type === "file"
    ? { type: "file" as const, url, mediaType }
    : { type: "image" as const, url, mediaType };
}

function convertStructuredPart(part: StructuredProviderPart): AgentRuntimeMessagePart | null {
  switch (part.type) {
    case "text":
      return createTextAgentRuntimePart(part.text);

    case "reasoning":
      return {
        type: "reasoning",
        ...(typeof part.text === "string" ? { text: part.text } : {}),
        ...(typeof part.signature === "string" ? { signature: part.signature } : {}),
        ...(typeof part.redactedData === "string" ? { redactedData: part.redactedData } : {}),
      };

    case "tool-call":
      return {
        type: "tool-call",
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        args: "input" in part ? toChildRunToolInputRecord(part.input) : {},
      };

    case "tool-result":
      return {
        type: "tool-result",
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        result: "output" in part ? part.output : null,
      };

    case "image":
    case "file":
      return toNativeFilePart(part.type, part);

    default: {
      const exhaustiveCheck: never = part;
      throw new AgentRuntimeMessageConversionError(
        `Unsupported agent runtime message part: ${String(exhaustiveCheck)}`,
      );
    }
  }
}

function createAttachmentReference(part: StructuredProviderPart): UploadedFileReference | null {
  const filename = getOptionalStringField(part, "filename");
  const mediaType = getOptionalStringField(part, "mediaType");
  const uploadId = getOptionalStringField(part, "uploadId");
  const uploadPath = getOptionalStringField(part, "uploadPath");
  const url = getOptionalStringField(part, "url");

  if (!mediaType) {
    return null;
  }

  const normalizedUrl = url?.startsWith("data:") ? undefined : url;

  return {
    name: filename ?? (part.type === "image" ? "image" : "file"),
    mediaType,
    ...(uploadId ? { uploadId } : {}),
    ...(uploadPath ? { path: uploadPath } : {}),
    ...(normalizedUrl ? { url: normalizedUrl } : {}),
  };
}

function buildAttachmentContextPart(
  attachmentReferences: UploadedFileReference[],
): AgentRuntimeMessagePart | null {
  if (attachmentReferences.length === 0) {
    return null;
  }

  return {
    type: "text",
    text: `Attached files from earlier conversation context:${
      buildDataFileAnnotation(attachmentReferences)
    }`,
  };
}

function hasUploadedFilesAnnotation(parts: StructuredProviderPart[]): boolean {
  return parts.some((part) => part.type === "text" && part.text.includes("<uploaded_files>"));
}

function convertContentToAgentRuntimeParts(
  message: ProviderModelMessage,
): AgentRuntimeMessage["parts"] {
  if (typeof message.content === "string") {
    const textPart = createTextAgentRuntimePart(message.content);
    return textPart ? [textPart] : [];
  }

  const parts: AgentRuntimeMessage["parts"] = [];
  const attachmentReferences: UploadedFileReference[] = [];

  for (const part of message.content) {
    const convertedPart = convertStructuredPart(part);
    if (convertedPart) {
      parts.push(convertedPart);
    }

    if (part.type === "image" || part.type === "file") {
      const attachmentReference = createAttachmentReference(part);
      if (attachmentReference) {
        attachmentReferences.push(attachmentReference);
      }
      continue;
    }
  }

  const attachmentContextPart = hasUploadedFilesAnnotation(message.content)
    ? null
    : buildAttachmentContextPart(attachmentReferences);
  if (attachmentContextPart) {
    parts.push(attachmentContextPart);
  }

  return parts;
}

function toJsonValue(value: unknown): JsonValue {
  if (value == null) {
    return null;
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => toJsonValue(item));
  }

  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, toJsonValue(entry)]),
    );
  }

  return JSON.stringify(value);
}

function toToolResultOutput(value: unknown): { type: "json"; value: JsonValue } {
  return {
    type: "json",
    value: toJsonValue(value),
  };
}

/** Return a runtime text part when the value carries text. */
export function getAgentRuntimeTextPart(part: unknown): { type: "text"; text: string } | null {
  return isRecord(part) && part.type === "text" && typeof part.text === "string"
    ? { type: "text", text: part.text }
    : null;
}

/** Return a runtime reasoning part when the value carries reasoning replay state. */
export function getAgentRuntimeReasoningPart(part: unknown): ProviderReasoningPart | null {
  if (!isRecord(part) || part.type !== "reasoning") {
    return null;
  }
  const text = typeof part.text === "string" ? part.text : undefined;
  const signature = typeof part.signature === "string" ? part.signature : undefined;
  const redactedData = typeof part.redactedData === "string" ? part.redactedData : undefined;
  if (!text && !signature && !redactedData) {
    return null;
  }
  return {
    type: "reasoning",
    ...(text ? { text } : {}),
    ...(signature ? { signature } : {}),
    ...(redactedData ? { redactedData } : {}),
  };
}

/** Return a runtime tool-call part when the value carries a tool call. */
export function getAgentRuntimeToolCallPart(
  part: unknown,
): { toolCallId: string; toolName: string; input: Record<string, unknown> } | null {
  if (!isRecord(part) || typeof part.type !== "string") {
    return null;
  }

  if (part.type !== "tool_call" && part.type !== "tool-call" && !part.type.startsWith("tool-")) {
    return null;
  }

  const toolCallId = getOptionalStringField(part, "toolCallId") ??
    getOptionalStringField(part, "tool_call_id") ??
    getOptionalStringField(part, "id");
  const toolName = getOptionalStringField(part, "toolName") ??
    getOptionalStringField(part, "tool_name") ??
    getOptionalStringField(part, "name") ??
    part.type.replace(/^tool-/, "");
  if (!toolCallId || toolName.length === 0) {
    return null;
  }

  return {
    toolCallId,
    toolName,
    input: toChildRunToolInputRecord(part.args ?? part.input),
  };
}

/** Return a runtime tool-result part when the value carries a tool result. */
export function getAgentRuntimeToolResultPart(
  part: unknown,
  toolNameFallback?: string,
): { toolCallId: string; toolName: string; output: unknown } | null {
  if (!isRecord(part) || part.type !== "tool-result" && part.type !== "tool_result") {
    return null;
  }

  const toolCallId = getOptionalStringField(part, "toolCallId") ??
    getOptionalStringField(part, "tool_call_id");
  const toolName = getOptionalStringField(part, "toolName") ??
    getOptionalStringField(part, "tool_name") ??
    toolNameFallback;
  if (!toolCallId || !toolName) {
    return null;
  }

  return {
    toolCallId,
    toolName,
    output: Object.hasOwn(part, "result")
      ? part.result
      : Object.hasOwn(part, "output")
      ? part.output
      : null,
  };
}

function getAgentRuntimeToolResultCallId(part: unknown): string | undefined {
  if (!isRecord(part) || part.type !== "tool-result" && part.type !== "tool_result") {
    return undefined;
  }

  return getOptionalStringField(part, "toolCallId") ??
    getOptionalStringField(part, "tool_call_id");
}

/** Create a chat tool-result part. */
export function createToolResultPart(part: {
  toolCallId: string;
  toolName: string;
  output: unknown;
}): ChatToolResultPart {
  return {
    type: "tool-result",
    toolCallId: part.toolCallId,
    toolName: part.toolName,
    output: toToolResultOutput(part.output),
  };
}

function joinTextParts(textParts: readonly ProviderTextPart[]): string {
  return textParts.map((part) => part.text).join("\n\n");
}

function collectAgentRuntimeProviderContentParts(
  parts: ReadonlyArray<AgentRuntimeMessageLikePart>,
): AgentRuntimeProviderContentParts {
  const textParts: ProviderTextPart[] = [];
  const reasoningParts: ProviderReasoningPart[] = [];
  const toolCallParts: ProviderToolCallPart[] = [];
  const toolResultParts: ChatToolResultPart[] = [];
  const fileParts: ChatModelFilePart[] = [];
  const toolNamesById = new Map<string, string>();

  for (const part of parts) {
    const textPart = getAgentRuntimeTextPart(part);
    if (textPart) {
      textParts.push(textPart);
      continue;
    }

    const reasoningPart = getAgentRuntimeReasoningPart(part);
    if (reasoningPart) {
      reasoningParts.push(reasoningPart);
      continue;
    }

    if (part.type === "image" || part.type === "file") {
      const nativePart = toNativeFilePart(part.type, part);
      if (nativePart) {
        fileParts.push(nativePart);
        continue;
      }
    }

    const toolResultCallId = getAgentRuntimeToolResultCallId(part);
    const toolResultPart = getAgentRuntimeToolResultPart(
      part,
      toolResultCallId ? toolNamesById.get(toolResultCallId) : undefined,
    );
    if (toolResultPart) {
      toolResultParts.push(createToolResultPart(toolResultPart));
      continue;
    }

    const toolCallPart = getAgentRuntimeToolCallPart(part);
    if (toolCallPart) {
      toolNamesById.set(toolCallPart.toolCallId, toolCallPart.toolName);
      toolCallParts.push({
        type: "tool-call",
        toolCallId: toolCallPart.toolCallId,
        toolName: toolCallPart.toolName,
        input: toolCallPart.input,
      });
    }
  }

  return { textParts, reasoningParts, toolCallParts, toolResultParts, fileParts };
}

function convertAssistantAgentRuntimePartsToProviderMessages(
  parts: ReadonlyArray<AgentRuntimeMessageLikePart>,
): ProviderModelMessage[] {
  const assistantContent: Array<ProviderReasoningPart | ProviderTextPart | ProviderToolCallPart> =
    [];
  const deferredAssistantContent: Array<
    ProviderReasoningPart | ProviderTextPart | ProviderToolCallPart
  > = [];
  const toolResults: ChatToolResultPart[] = [];
  const pendingToolCallIds = new Set<string>();
  const toolNamesById = new Map<string, string>();
  const providerMessages: ProviderModelMessage[] = [];

  const flushAssistantMessage = (
    content: Array<ProviderReasoningPart | ProviderTextPart | ProviderToolCallPart>,
  ) => {
    if (content.length === 0) {
      return;
    }

    providerMessages.push({ role: "assistant", content: [...content] });
    content.length = 0;
  };

  const flushToolMessage = () => {
    if (toolResults.length === 0) {
      return;
    }

    providerMessages.push({ role: "tool", content: [...toolResults] });
    toolResults.length = 0;
  };

  const pushAssistantPart = (
    part: ProviderReasoningPart | ProviderTextPart | ProviderToolCallPart,
  ) => {
    if (part.type === "tool-call") {
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

  const pushToolResult = (part: ChatToolResultPart) => {
    toolResults.push(part);
    pendingToolCallIds.delete(part.toolCallId);
  };

  for (const part of parts) {
    const textPart = getAgentRuntimeTextPart(part);
    if (textPart) {
      pushAssistantPart(textPart);
      continue;
    }

    const reasoningPart = getAgentRuntimeReasoningPart(part);
    if (reasoningPart) {
      pushAssistantPart(reasoningPart);
      continue;
    }

    const toolResultCallId = getAgentRuntimeToolResultCallId(part);
    const toolResultPart = getAgentRuntimeToolResultPart(
      part,
      toolResultCallId ? toolNamesById.get(toolResultCallId) : undefined,
    );
    if (toolResultPart) {
      pushToolResult(createToolResultPart(toolResultPart));
      continue;
    }

    const toolCallPart = getAgentRuntimeToolCallPart(part);
    if (toolCallPart) {
      pushAssistantPart({
        type: "tool-call",
        toolCallId: toolCallPart.toolCallId,
        toolName: toolCallPart.toolName,
        input: toolCallPart.input,
      });
    }
  }

  flushAssistantMessage(assistantContent);
  flushToolMessage();
  flushAssistantMessage(deferredAssistantContent);

  return providerMessages;
}

function createProviderMessagesFromAgentRuntimeMessage(
  message: Pick<AgentRuntimeMessage, "role"> & {
    parts: ReadonlyArray<AgentRuntimeMessageLikePart>;
  },
): ProviderModelMessage[] {
  if (message.role === "assistant") {
    return convertAssistantAgentRuntimePartsToProviderMessages(message.parts);
  }

  const { textParts, toolResultParts, fileParts } = collectAgentRuntimeProviderContentParts(
    message.parts,
  );

  switch (message.role) {
    case "tool":
      if (toolResultParts.length === 0) {
        return [];
      }

      return [{
        role: "tool",
        content: toolResultParts,
      }];

    case "user": {
      if (textParts.length === 0 && fileParts.length === 0) {
        return [];
      }

      if (fileParts.length === 0) {
        return [{
          role: "user",
          content: joinTextParts(textParts),
        }];
      }

      const content: ChatUserContentPart[] = [...textParts, ...fileParts];
      return [{
        role: "user",
        content,
      }];
    }

    case "system": {
      if (textParts.length === 0) {
        return [];
      }

      return [{
        role: "system",
        content: joinTextParts(textParts),
      }];
    }

    default: {
      const exhaustiveCheck: never = message.role;
      throw new AgentRuntimeMessageConversionError(
        `Unsupported agent runtime message role when converting to provider model message: ${
          String(exhaustiveCheck)
        }`,
      );
    }
  }
}

/** Convert provider messages to agent runtime messages. */
export function convertProviderMessagesToAgentRuntimeMessages(
  messages: readonly ProviderModelMessage[],
): AgentRuntimeMessage[] {
  return messages.map((message, index) => ({
    id: createAgentRuntimeMessageId(message, index),
    role: message.role,
    parts: convertContentToAgentRuntimeParts(message),
    timestamp: index,
  }));
}

/** Convert agent runtime messages to provider messages. */
export function convertAgentRuntimeMessagesToProviderMessages(
  messages: ReadonlyArray<
    Pick<AgentRuntimeMessage, "role"> & { parts: ReadonlyArray<AgentRuntimeMessageLikePart> }
  >,
): ProviderModelMessage[] {
  const converted: ProviderModelMessage[] = [];

  for (const message of messages) {
    converted.push(...createProviderMessagesFromAgentRuntimeMessage(message));
  }

  return converted;
}
