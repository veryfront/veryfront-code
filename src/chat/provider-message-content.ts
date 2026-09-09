import { filterPrivateArray } from "#veryfront/security/private-array.ts";
import { isRecord } from "./part-field-access.ts";
import type { ProviderModelMessage } from "./types.ts";

function hasNonEmptyStringField(record: Record<string, unknown>, key: string): boolean {
  return typeof record[key] === "string" && record[key].trim().length > 0;
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
        (part.providerExecuted === undefined || typeof part.providerExecuted === "boolean");
    case "tool-result":
      return (role === "assistant" || role === "tool") &&
        hasNonEmptyStringField(part, "toolCallId") &&
        hasNonEmptyStringField(part, "toolName") &&
        hasValidToolResultOutput(part.output) &&
        (part.providerExecuted === undefined || typeof part.providerExecuted === "boolean");
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

      const url = typeof part.url === "string" ? part.url : "";
      if (url.startsWith("data:image/") && part.filename === "preview-screenshot.png") {
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
    return message.role !== "tool" && content.trim().length > 0;
  }
  if (Array.isArray(content)) return cleanContent(content, message.role).length > 0;
  return false;
}

export function cleanContent<T>(content: T[], role: ProviderModelMessage["role"]): T[] {
  const hasSubstantiveContent = content.some((part) => isKeepableModelPart(part, role, false));
  return filterPrivateArray(
    content,
    (part) => isKeepableModelPart(part, role, hasSubstantiveContent),
  );
}
