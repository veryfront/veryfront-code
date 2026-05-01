import { isRecord } from "../chat/conversation.ts";
import {
  buildDataFileAnnotation,
  type ChatModelMessage,
  type ChatToolResultPart,
  type UploadedFileReference,
} from "../chat/types.ts";
import { toChildRunToolInputRecord } from "./child-run-execution-support.ts";

type StructuredModelPart = Exclude<ChatModelMessage["content"], string>[number];

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

type FrameworkMessageLikePart =
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

export type FrameworkMessagePart =
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

export interface FrameworkMessage {
  id: string;
  role: ChatModelMessage["role"];
  parts: FrameworkMessagePart[];
  timestamp: number;
}

interface FrameworkModelContentParts {
  textParts: FrameworkModelTextPart[];
  toolCallParts: FrameworkModelToolCallPart[];
  toolResultParts: ChatToolResultPart[];
}

type FrameworkModelTextPart = { type: "text"; text: string };

type FrameworkModelToolCallPart = {
  type: "tool-call";
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
};

export class FrameworkMessageConversionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FrameworkMessageConversionError";
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

function createFrameworkMessageId(message: ChatModelMessage, index: number): string {
  return `framework-${message.role}-${index + 1}`;
}

function createTextFrameworkPart(text: string): FrameworkMessagePart | null {
  return hasTextContent(text) ? { type: "text", text } : null;
}

function convertStructuredPart(part: StructuredModelPart): FrameworkMessagePart | null {
  switch (part.type) {
    case "text":
      return createTextFrameworkPart(part.text);

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
      throw new FrameworkMessageConversionError(
        `Unsupported framework message part: ${String(exhaustiveCheck)}`,
      );
    }
  }
}

function createAttachmentReference(part: StructuredModelPart): UploadedFileReference | null {
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
): FrameworkMessagePart | null {
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

function convertContentToFrameworkParts(message: ChatModelMessage): FrameworkMessage["parts"] {
  if (typeof message.content === "string") {
    const textPart = createTextFrameworkPart(message.content);
    return textPart ? [textPart] : [];
  }

  const parts: FrameworkMessage["parts"] = [];
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

export function getFrameworkTextPart(part: unknown): { type: "text"; text: string } | null {
  return isRecord(part) && part.type === "text" && typeof part.text === "string"
    ? { type: "text", text: part.text }
    : null;
}

export function getFrameworkToolCallPart(
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

export function getFrameworkToolResultPart(
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

function joinTextParts(textParts: readonly FrameworkModelTextPart[]): string {
  return textParts.map((part) => part.text).join("\n\n");
}

function collectFrameworkModelContentParts(
  parts: ReadonlyArray<FrameworkMessageLikePart>,
): FrameworkModelContentParts {
  const textParts: FrameworkModelTextPart[] = [];
  const toolCallParts: FrameworkModelToolCallPart[] = [];
  const toolResultParts: ChatToolResultPart[] = [];

  for (const part of parts) {
    const textPart = getFrameworkTextPart(part);
    if (textPart) {
      textParts.push(textPart);
      continue;
    }

    const toolResultPart = getFrameworkToolResultPart(part);
    if (toolResultPart) {
      toolResultParts.push(createToolResultPart(toolResultPart));
      continue;
    }

    const toolCallPart = getFrameworkToolCallPart(part);
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

function createModelMessageFromFrameworkMessage(
  message: Pick<FrameworkMessage, "role"> & { parts: ReadonlyArray<FrameworkMessageLikePart> },
): ChatModelMessage | null {
  const { textParts, toolCallParts, toolResultParts } = collectFrameworkModelContentParts(
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
      throw new FrameworkMessageConversionError(
        `Unsupported framework message role when converting to model message: ${
          String(exhaustiveCheck)
        }`,
      );
    }
  }
}

export function convertModelMessagesToFrameworkMessages(
  messages: readonly ChatModelMessage[],
): FrameworkMessage[] {
  return messages.map((message, index) => ({
    id: createFrameworkMessageId(message, index),
    role: message.role,
    parts: convertContentToFrameworkParts(message),
    timestamp: index,
  }));
}

export function convertFrameworkMessagesToModelMessages(
  messages: ReadonlyArray<
    Pick<FrameworkMessage, "role"> & { parts: ReadonlyArray<FrameworkMessageLikePart> }
  >,
): ChatModelMessage[] {
  const converted: ChatModelMessage[] = [];

  for (const message of messages) {
    const convertedMessage = createModelMessageFromFrameworkMessage(message);
    if (convertedMessage) {
      converted.push(convertedMessage);
    }
  }

  return converted;
}
