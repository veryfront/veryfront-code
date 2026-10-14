import { inheritToolResultSource } from "#veryfront/chat/tool-result-source.ts";
import {
  appendPrivateArray,
  concatPrivateArrays,
  joinPrivateArray,
  mapPrivateArray,
  pushPrivateArray,
  somePrivateArray,
} from "#veryfront/security/private-array.ts";
import type { ToolResultPart } from "../types.ts";
import { hasTrustedPlatformPolicyToolResultPart } from "./skill-policy-enforcement.ts";
import { readToolResultOwnDataProperty } from "#veryfront/tool/result.ts";
import { toChatJsonValue } from "#veryfront/chat/json-value.ts";
import { createPrivateMap } from "#veryfront/security/private-map.ts";
import { createPrivateSet } from "#veryfront/security/private-set.ts";
import {
  privateTextEndsWith,
  privateTextIncludes,
  privateTextStartsWith,
  privateTextTrim,
} from "#veryfront/security/private-text.ts";
import { privateJsonParse } from "#veryfront/security/private-json.ts";
import { getProviderModelMessageSourceId, isRecord } from "#veryfront/chat/conversation.ts";
import {
  buildDataFileAnnotation,
  type ChatModelFilePart,
  type ChatSourceDocumentUiPart,
  type ChatSourceUrlUiPart,
  type ChatToolResultPart,
  type ChatUserContentPart,
  type ProviderModelMessage,
  type UploadedFileReference,
} from "../../chat/types.ts";
import { toChildRunToolInputRecord } from "../child-run/execution-support.ts";

const hasOwn = Object.hasOwn;

type StructuredProviderPart = Exclude<ProviderModelMessage["content"], string>[number];

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

type RuntimeAttachmentFields = {
  url: string;
  mediaType: string;
  filename?: string;
  uploadId?: string;
  uploadPath?: string;
};

type RuntimeAttachmentPart =
  | ({ type: "image" } & RuntimeAttachmentFields)
  | ({ type: "file" } & RuntimeAttachmentFields);

type RuntimeAttachmentLikePart = RuntimeAttachmentPart & {
  upload_id?: string;
  upload_path?: string;
};

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
  | RuntimeAttachmentLikePart
  | ChatSourceUrlUiPart
  | ChatSourceDocumentUiPart;

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
  | RuntimeAttachmentPart
  | ChatSourceUrlUiPart
  | ChatSourceDocumentUiPart;

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
  return privateTextTrim(text).length > 0;
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
): RuntimeAttachmentPart | null {
  const url = getOptionalStringField(part, "url");
  const mediaType = getOptionalStringField(part, "mediaType");
  // `data:` URLs (inline base64) are kept: guest / no-project attachments ride
  // inline so the model sees them without a fetchable upload URL.
  if (!url || !mediaType) {
    return null;
  }

  const filename = getOptionalStringField(part, "filename");
  const uploadId = getOptionalStringField(part, "uploadId") ??
    getOptionalStringField(part, "upload_id");
  const uploadPath = getOptionalStringField(part, "uploadPath") ??
    getOptionalStringField(part, "upload_path");
  const sharedFields = {
    url,
    mediaType,
    ...(filename ? { filename } : {}),
    ...(uploadId ? { uploadId } : {}),
    ...(uploadPath ? { uploadPath } : {}),
  };

  return type === "file"
    ? { type: "file" as const, ...sharedFields }
    : { type: "image" as const, ...sharedFields };
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
      return inheritToolResultSource<
        Extract<AgentRuntimeMessage["parts"][number], { type: "tool-result" }>
      >(part, {
        type: "tool-result",
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        result: "output" in part ? part.output : null,
      });

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
  const uploadId = getOptionalStringField(part, "uploadId") ??
    getOptionalStringField(part, "upload_id");
  const uploadPath = getOptionalStringField(part, "uploadPath") ??
    getOptionalStringField(part, "upload_path");
  const url = getOptionalStringField(part, "url");

  if (!mediaType) {
    return null;
  }

  const normalizedUrl = url !== undefined && privateTextStartsWith(url, "data:") ? undefined : url;

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
  return somePrivateArray(
    parts,
    (part) => part.type === "text" && privateTextIncludes(part.text, "<uploaded_files>"),
  );
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

  for (let index = 0; index < message.content.length; index++) {
    if (!hasOwn(message.content, index)) continue;
    const part = message.content[index]!;
    const convertedPart = convertStructuredPart(part);
    if (convertedPart) {
      pushPrivateArray(parts, convertedPart);
    }

    if (part.type === "image" || part.type === "file") {
      const attachmentReference = createAttachmentReference(part);
      if (attachmentReference) {
        pushPrivateArray(attachmentReferences, attachmentReference);
      }
      continue;
    }
  }

  const attachmentContextPart = hasUploadedFilesAnnotation(message.content)
    ? null
    : buildAttachmentContextPart(attachmentReferences);
  if (attachmentContextPart) {
    pushPrivateArray(parts, attachmentContextPart);
  }

  return parts;
}

function toToolResultOutput(value: unknown): { type: "json"; value: JsonValue } {
  return {
    type: "json",
    value: toChatJsonValue(value),
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

  if (
    part.type !== "tool_call" && part.type !== "tool-call" &&
    !privateTextStartsWith(part.type, "tool-")
  ) {
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
    output: hasOwn(part, "result") ? part.result : hasOwn(part, "output") ? part.output : null,
  };
}

function getAgentRuntimeToolResultCallId(part: unknown): string | undefined {
  if (!isRecord(part) || part.type !== "tool-result" && part.type !== "tool_result") {
    return undefined;
  }

  return getOptionalStringField(part, "toolCallId") ??
    getOptionalStringField(part, "tool_call_id");
}

function hasCompletedChildResult(value: unknown): boolean {
  return isRecord(value) && hasOwn(value, "ok") && value.ok === true &&
    hasOwn(value, "status") && value.status === "completed" &&
    hasOwn(value, "childRunId") && typeof value.childRunId === "string";
}

function hasCompletedStructuredChildOutput(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && hasCompletedChildResult(value) && hasOwn(value, "output") &&
    value.output !== null && typeof value.output === "object";
}

function hasAcceptedChildResultText(value: unknown): value is Record<string, unknown> {
  return isRecord(value) &&
    (hasCompletedChildResult(value) ||
      (hasOwn(value, "success") && value.success === true &&
        !hasOwn(value, "ok") && !hasOwn(value, "status"))) &&
    ((hasCompletedChildResult(value) && hasOwn(value, "text") &&
      typeof value.text === "string" && value.text.length > 0) ||
      (hasOwn(value, "summary") && isRecord(value.summary) &&
        hasOwn(value.summary, "text") && typeof value.summary.text === "string" &&
        value.summary.text.length > 0));
}

/** @internal Recognize platform child results without claiming project-owned aliases. */
export function isProviderChildToolResult(
  part: { toolCallId: string; toolName: string; output: unknown },
  sourcePart?: unknown,
): boolean {
  return (part.toolName === "invoke_agent" || part.toolName === "veryfront__invoke_agent") &&
    isRecord(sourcePart) &&
    hasTrustedPlatformPolicyToolResultPart(sourcePart as ToolResultPart) &&
    readToolResultOwnDataProperty(sourcePart, "toolCallId") === part.toolCallId &&
    readToolResultOwnDataProperty(sourcePart, "toolName") === part.toolName &&
    readToolResultOwnDataProperty(sourcePart, "result") === part.output;
}

/** @internal Normalize provider-visible results while preserving durable tool history. */
export function createProviderToolResultOutput(part: {
  toolCallId: string;
  toolName: string;
  output: unknown;
}, sourcePart?: unknown): { type: "json"; value: JsonValue } {
  const isChildResult = isProviderChildToolResult(part, sourcePart);
  const output = toToolResultOutput(part.output);
  let value = output.value;
  if (isChildResult) {
    let candidate: unknown = value;
    if (
      isRecord(candidate) && hasOwn(candidate, "type") &&
      (candidate.type === "json" || candidate.type === "text") &&
      hasOwn(candidate, "value")
    ) {
      candidate = candidate.value;
    }
    if (typeof candidate === "string") {
      try {
        candidate = privateJsonParse(candidate);
      } catch {
        // Preserve malformed or non-JSON tool text for error recovery.
      }
    }
    if (
      hasCompletedStructuredChildOutput(candidate) ||
      (hasAcceptedChildResultText(candidate) && hasOwn(candidate, "rootResponseHint") &&
        isRecord(candidate.rootResponseHint)) ||
      (isRecord(candidate) && hasOwn(candidate, "childRunId") &&
        typeof candidate.childRunId === "string" && hasOwn(candidate, "text") &&
        typeof candidate.text === "string" && hasOwn(candidate, "summary") &&
        isRecord(candidate.summary) && hasOwn(candidate.summary, "text") &&
        candidate.summary.text === candidate.text)
    ) {
      value = toChatJsonValue(candidate);
      output.value = value;
    }
  }
  // Root response suggestions derive from the child prose. Keep the guidance,
  // but do not replay its additional copy beside the accepted child result.
  if (
    isChildResult &&
    (hasCompletedStructuredChildOutput(value) || hasAcceptedChildResultText(value)) &&
    hasOwn(value, "rootResponseHint") && isRecord(value.rootResponseHint)
  ) {
    delete value.rootResponseHint.suggestedText;
  }
  // Structured output is the accepted child value. Trace prose can describe
  // other intermediate results, so keep it in durable history, not the handoff.
  if (isChildResult && hasCompletedStructuredChildOutput(value)) {
    delete value.text;
    if (hasOwn(value, "summary") && isRecord(value.summary)) delete value.summary.text;
    return output;
  }
  // The durable child envelope keeps both fields for compatibility. Providers
  // need the text once, alongside the remaining summary metadata.
  if (
    isChildResult && isRecord(value) &&
    hasOwn(value, "childRunId") && typeof value.childRunId === "string" &&
    hasOwn(value, "text") && typeof value.text === "string" &&
    hasOwn(value, "summary") && isRecord(value.summary) && hasOwn(value.summary, "text") &&
    value.summary.text === value.text
  ) {
    delete value.summary.text;
    if (
      hasOwn(value, "output") && typeof value.output === "string" && value.output.length > 0 &&
      privateTextEndsWith(value.text, value.output)
    ) {
      delete value.output;
    }
  }
  return output;
}

/** Create a chat tool-result part. */
export function createToolResultPart(part: {
  toolCallId: string;
  toolName: string;
  output: unknown;
}, sourcePart?: unknown): ChatToolResultPart {
  return {
    type: "tool-result",
    toolCallId: part.toolCallId,
    toolName: part.toolName,
    output: createProviderToolResultOutput(part, sourcePart),
  };
}

function joinTextParts(textParts: readonly ProviderTextPart[]): string {
  return joinPrivateArray(mapPrivateArray(textParts, (part) => part.text), "\n\n");
}

function collectAgentRuntimeProviderContentParts(
  parts: ReadonlyArray<AgentRuntimeMessageLikePart>,
): AgentRuntimeProviderContentParts {
  const textParts: ProviderTextPart[] = [];
  const reasoningParts: ProviderReasoningPart[] = [];
  const toolCallParts: ProviderToolCallPart[] = [];
  const toolResultParts: ChatToolResultPart[] = [];
  const fileParts: ChatModelFilePart[] = [];
  const toolNamesById = createPrivateMap<string, string>();

  for (let index = 0; index < parts.length; index++) {
    if (!hasOwn(parts, index)) continue;
    const part = parts[index]!;
    if (part.type === "source-url" || part.type === "source-document") {
      continue;
    }

    const textPart = getAgentRuntimeTextPart(part);
    if (textPart) {
      pushPrivateArray(textParts, textPart);
      continue;
    }

    const reasoningPart = getAgentRuntimeReasoningPart(part);
    if (reasoningPart) {
      pushPrivateArray(reasoningParts, reasoningPart);
      continue;
    }

    if (part.type === "image" || part.type === "file") {
      const nativePart = toNativeFilePart(part.type, part);
      if (nativePart) {
        pushPrivateArray(fileParts, nativePart);
        continue;
      }
    }

    const toolResultCallId = getAgentRuntimeToolResultCallId(part);
    const toolResultPart = getAgentRuntimeToolResultPart(
      part,
      toolResultCallId ? toolNamesById.get(toolResultCallId) : undefined,
    );
    if (toolResultPart) {
      pushPrivateArray(toolResultParts, createToolResultPart(toolResultPart, part));
      continue;
    }

    const toolCallPart = getAgentRuntimeToolCallPart(part);
    if (toolCallPart) {
      toolNamesById.set(toolCallPart.toolCallId, toolCallPart.toolName);
      pushPrivateArray(toolCallParts, {
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
  const pendingToolCallIds = createPrivateSet<string>();
  const toolNamesById = createPrivateMap<string, string>();
  const providerMessages: ProviderModelMessage[] = [];

  const flushAssistantMessage = (
    content: Array<ProviderReasoningPart | ProviderTextPart | ProviderToolCallPart>,
  ) => {
    if (content.length === 0) {
      return;
    }

    pushPrivateArray(providerMessages, {
      role: "assistant",
      content: mapPrivateArray(content, (part) => part),
    });
    content.length = 0;
  };

  const flushToolMessage = () => {
    if (toolResults.length === 0) {
      return;
    }

    pushPrivateArray(providerMessages, {
      role: "tool",
      content: mapPrivateArray(toolResults, (part) => part),
    });
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

      pushPrivateArray(assistantContent, part);
      pendingToolCallIds.add(part.toolCallId);
      toolNamesById.set(part.toolCallId, part.toolName);
      return;
    }

    if (pendingToolCallIds.size > 0) {
      pushPrivateArray(deferredAssistantContent, part);
      return;
    }

    if (toolResults.length > 0) {
      flushAssistantMessage(assistantContent);
      flushToolMessage();
      flushAssistantMessage(deferredAssistantContent);
    }

    pushPrivateArray(assistantContent, part);
  };

  const pushToolResult = (part: ChatToolResultPart) => {
    pushPrivateArray(toolResults, part);
    pendingToolCallIds.delete(part.toolCallId);
  };

  for (let index = 0; index < parts.length; index++) {
    if (!hasOwn(parts, index)) continue;
    const part = parts[index]!;
    if (part.type === "source-url" || part.type === "source-document") {
      continue;
    }

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
      pushToolResult(createToolResultPart(toolResultPart, part));
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

      const content = concatPrivateArrays<ChatUserContentPart>(textParts, fileParts);
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
  return mapPrivateArray(messages, (message, index) => ({
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

  for (let index = 0; index < messages.length; index++) {
    if (!hasOwn(messages, index)) continue;
    const message = messages[index]!;
    appendPrivateArray(converted, createProviderMessagesFromAgentRuntimeMessage(message));
  }

  return converted;
}
