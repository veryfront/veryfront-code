import { isRecord } from "../chat/conversation.ts";
import {
  buildDataFileAnnotation,
  type ChatToolResultPart,
  type ProviderModelMessage,
  type UploadedFileReference,
} from "../chat/types.ts";
import { toChildRunToolInputRecord } from "./child-run-execution-support.ts";

type StructuredProviderPart = Exclude<ProviderModelMessage["content"], string>[number];

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

type AgentRuntimeMessageLikePart =
  | { type: "text"; text: string }
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
    type: "tool-result";
    toolCallId: string;
    toolName: string;
    result: unknown;
  }
  | {
    type: "tool-result";
    toolCallId: string;
    toolName: string;
    output: unknown;
  };

export type AgentRuntimeMessagePart =
  | { type: "text"; text: string }
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
  };

export interface AgentRuntimeMessage {
  id: string;
  role: ProviderModelMessage["role"];
  parts: AgentRuntimeMessagePart[];
  timestamp: number;
}

interface AgentRuntimeProviderContentParts {
  textParts: ProviderTextPart[];
  toolCallParts: ProviderToolCallPart[];
  toolResultParts: ChatToolResultPart[];
}

type ProviderTextPart = { type: "text"; text: string };

type ProviderToolCallPart = {
  type: "tool-call";
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
};

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
  return `agent-runtime-${message.role}-${index + 1}`;
}

function createTextAgentRuntimePart(text: string): AgentRuntimeMessagePart | null {
  return hasTextContent(text) ? { type: "text", text } : null;
}

function convertStructuredPart(part: StructuredProviderPart): AgentRuntimeMessagePart | null {
  switch (part.type) {
    case "text":
      return createTextAgentRuntimePart(part.text);

    case "reasoning":
      return null;

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
      return null;

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
    if (part.type === "image" || part.type === "file") {
      const attachmentReference = createAttachmentReference(part);
      if (attachmentReference) {
        attachmentReferences.push(attachmentReference);
      }
      continue;
    }

    const convertedPart = convertStructuredPart(part);
    if (convertedPart) {
      parts.push(convertedPart);
    }
  }

  const attachmentContextPart = buildAttachmentContextPart(attachmentReferences);
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

export function getAgentRuntimeTextPart(part: unknown): { type: "text"; text: string } | null {
  return isRecord(part) && part.type === "text" && typeof part.text === "string"
    ? { type: "text", text: part.text }
    : null;
}

export function getAgentRuntimeToolCallPart(
  part: unknown,
): { toolCallId: string; toolName: string; input: Record<string, unknown> } | null {
  if (!isRecord(part) || typeof part.type !== "string") {
    return null;
  }

  if (part.type !== "tool-call" && !part.type.startsWith("tool-")) {
    return null;
  }

  const toolCallId = getOptionalStringField(part, "toolCallId");
  const toolName = getOptionalStringField(part, "toolName") ?? part.type.replace(/^tool-/, "");
  if (!toolCallId || toolName.length === 0) {
    return null;
  }

  return {
    toolCallId,
    toolName,
    input: toChildRunToolInputRecord(part.args ?? part.input),
  };
}

export function getAgentRuntimeToolResultPart(
  part: unknown,
): { toolCallId: string; toolName: string; output: unknown } | null {
  if (!isRecord(part) || part.type !== "tool-result") {
    return null;
  }

  const toolCallId = getOptionalStringField(part, "toolCallId");
  const toolName = getOptionalStringField(part, "toolName");
  if (!toolCallId || !toolName) {
    return null;
  }

  return {
    toolCallId,
    toolName,
    output: Object.hasOwn(part, "result") ? part.result : null,
  };
}

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
  const toolCallParts: ProviderToolCallPart[] = [];
  const toolResultParts: ChatToolResultPart[] = [];

  for (const part of parts) {
    const textPart = getAgentRuntimeTextPart(part);
    if (textPart) {
      textParts.push(textPart);
      continue;
    }

    const toolResultPart = getAgentRuntimeToolResultPart(part);
    if (toolResultPart) {
      toolResultParts.push(createToolResultPart(toolResultPart));
      continue;
    }

    const toolCallPart = getAgentRuntimeToolCallPart(part);
    if (toolCallPart) {
      toolCallParts.push({
        type: "tool-call",
        toolCallId: toolCallPart.toolCallId,
        toolName: toolCallPart.toolName,
        input: toolCallPart.input,
      });
    }
  }

  return { textParts, toolCallParts, toolResultParts };
}

function createProviderMessageFromAgentRuntimeMessage(
  message: Pick<AgentRuntimeMessage, "role"> & {
    parts: ReadonlyArray<AgentRuntimeMessageLikePart>;
  },
): ProviderModelMessage | null {
  const { textParts, toolCallParts, toolResultParts } = collectAgentRuntimeProviderContentParts(
    message.parts,
  );

  switch (message.role) {
    case "assistant":
      if (textParts.length === 0 && toolCallParts.length === 0) {
        return null;
      }

      return {
        role: "assistant",
        content: [...textParts, ...toolCallParts],
      };

    case "tool":
      if (toolResultParts.length === 0) {
        return null;
      }

      return {
        role: "tool",
        content: toolResultParts,
      };

    case "user": {
      if (textParts.length === 0) {
        return null;
      }

      return {
        role: "user",
        content: joinTextParts(textParts),
      };
    }

    case "system": {
      if (textParts.length === 0) {
        return null;
      }

      return {
        role: "system",
        content: joinTextParts(textParts),
      };
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

export function convertAgentRuntimeMessagesToProviderMessages(
  messages: ReadonlyArray<
    Pick<AgentRuntimeMessage, "role"> & { parts: ReadonlyArray<AgentRuntimeMessageLikePart> }
  >,
): ProviderModelMessage[] {
  const converted: ProviderModelMessage[] = [];

  for (const message of messages) {
    const convertedMessage = createProviderMessageFromAgentRuntimeMessage(message);
    if (convertedMessage) {
      converted.push(convertedMessage);
    }
  }

  return converted;
}
