/**
 * Interpreting one message part.
 *
 * The single owner of turning one raw or UI message part — tool-call,
 * tool-result, text, reasoning, or file/image — into a normalized shape, so
 * provider conversion and replay reconciliation read the same interpretation
 * of a part rather than each deriving their own.
 */
import {
  getNonEmptyStringField,
  getOptionalStringField,
  isRecord,
  stringifyUnknown,
  toJsonValue,
  toRecord,
} from "./part-field-access.ts";
import type { JsonValue } from "./part-field-access.ts";

export function getToolPart(part: unknown): {
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

export function getRawToolCallPart(part: unknown): {
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
  state?: string;
  output?: unknown;
  errorText?: string;
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
    ...(typeof part.state === "string" ? { state: part.state } : {}),
    ...(Object.hasOwn(part, "output") ? { output: part.output } : {}),
    ...(typeof part.errorText === "string" ? { errorText: part.errorText } : {}),
  };
}

export function getRawToolResultPart(part: unknown): {
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

export function buildToolResultOutput(
  toolPart: { state: string; output?: unknown; errorText?: string },
):
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

export function buildRawToolCallResultOutput(
  rawToolCall: NonNullable<ReturnType<typeof getRawToolCallPart>>,
): ReturnType<typeof buildToolResultOutput> {
  if (!rawToolCall.state) {
    return null;
  }

  return buildToolResultOutput({
    state: rawToolCall.state,
    ...(rawToolCall.output !== undefined ? { output: rawToolCall.output } : {}),
    ...(rawToolCall.errorText !== undefined ? { errorText: rawToolCall.errorText } : {}),
  });
}

export function hasSelfContainedRawToolCallResult(
  rawToolCall: NonNullable<ReturnType<typeof getRawToolCallPart>>,
): boolean {
  if (
    rawToolCall.state === "error" && rawToolCall.output === undefined &&
    rawToolCall.errorText === undefined
  ) {
    return false;
  }

  return buildRawToolCallResultOutput(rawToolCall) !== null;
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

export function isProviderVisibleReasoningPart(value: unknown): value is ReasoningPartLike {
  return isReasoningPart(value) &&
    (getNonEmptyStringField(value, "text") !== undefined ||
      getNonEmptyStringField(value, "signature") !== undefined ||
      getNonEmptyStringField(value, "redactedData") !== undefined);
}

export function getFilePart(part: unknown): {
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
  const url = getNonEmptyStringField(part, "url");
  if (!mediaType || !url) {
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
    data: url,
    url,
    ...(filename ? { filename } : {}),
    ...(uploadId ? { uploadId } : {}),
    ...(uploadPath ? { uploadPath } : {}),
  };
}
