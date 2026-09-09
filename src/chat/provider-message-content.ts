import { filterPrivateArray, somePrivateArray } from "#veryfront/security/private-array.ts";
import { privateTextStartsWith, privateTextTrim } from "#veryfront/security/private-text.ts";
import { isRecord } from "./part-field-access.ts";
import type { ProviderModelMessage } from "./types.ts";

const isArray = Array.isArray;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const hasOwn = Object.hasOwn;

function ownField(record: Record<string, unknown>, key: string): unknown {
  const descriptor = getOwnPropertyDescriptor(record, key);
  return descriptor && hasOwn(descriptor, "value") ? descriptor.value : undefined;
}

function hasNonEmptyStringField(record: Record<string, unknown>, key: string): boolean {
  const value = ownField(record, key);
  return typeof value === "string" && privateTextTrim(value).length > 0;
}

function hasValidToolResultOutput(value: unknown): boolean {
  if (!isRecord(value) || typeof value.type !== "string") {
    return false;
  }

  switch (value.type) {
    case "json":
      return "value" in value;
    case "text":
    case "error-text":
      return typeof value.value === "string";
    default:
      return false;
  }
}

function isKeepableModelPart(
  part: unknown,
  role: ProviderModelMessage["role"],
  includeReasoning: boolean,
): boolean {
  if (!isRecord(part) || typeof part.type !== "string") return false;
  const providerExecuted = ownField(part, "providerExecuted");

  switch (part.type) {
    case "text":
      return role !== "tool" && hasNonEmptyStringField(part, "text");
    case "reasoning":
      return role === "assistant" &&
        includeReasoning &&
        (
          hasNonEmptyStringField(part, "text") ||
          hasNonEmptyStringField(part, "signature") ||
          hasNonEmptyStringField(part, "redactedData")
        );
    case "tool-call":
      return role === "assistant" &&
        hasNonEmptyStringField(part, "toolCallId") &&
        hasNonEmptyStringField(part, "toolName") &&
        isRecord(part.input) &&
        (providerExecuted === undefined || typeof providerExecuted === "boolean");
    case "tool-result":
      return (role === "assistant" || role === "tool") &&
        hasNonEmptyStringField(part, "toolCallId") &&
        hasNonEmptyStringField(part, "toolName") &&
        hasValidToolResultOutput(part.output) &&
        (providerExecuted === undefined || typeof providerExecuted === "boolean");
    case "image":
    case "file": {
      if (
        role === "system" ||
        role === "tool" ||
        !hasNonEmptyStringField(part, "mediaType") ||
        (!hasNonEmptyStringField(part, "data") && !hasNonEmptyStringField(part, "url"))
      ) {
        return false;
      }

      const url = ownField(part, "url");
      if (
        typeof url === "string" && privateTextStartsWith(url, "data:image/") &&
        ownField(part, "filename") === "preview-screenshot.png"
      ) {
        return false;
      }
      return true;
    }
    default:
      return false;
  }
}

export function hasValidContent(message: ProviderModelMessage): boolean {
  const content = message.content;

  if (content === undefined || content === null) return false;
  if (typeof content === "string") {
    return message.role !== "tool" && privateTextTrim(content).length > 0;
  }
  if (isArray(content)) return cleanContent(content, message.role).length > 0;
  return false;
}

export function cleanContent<T>(content: T[], role: ProviderModelMessage["role"]): T[] {
  const hasSubstantiveContent = somePrivateArray(
    content,
    (part) => isKeepableModelPart(part, role, false),
  );
  return filterPrivateArray(
    content,
    (part) => isKeepableModelPart(part, role, hasSubstantiveContent),
  );
}
