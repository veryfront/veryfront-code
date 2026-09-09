import { flatMapPrivateArray, somePrivateArray } from "#veryfront/security/private-array.ts";
import { createPrivateMap } from "#veryfront/security/private-map.ts";
import { isRecord } from "#veryfront/chat/conversation.ts";

const regexpExec = RegExp.prototype.exec;
const apply = Reflect.apply;
const arrayIsArray = Array.isArray;
const objectValues = Object.values;
const hasOwn = Object.hasOwn;
const parseJson = JSON.parse;
const stringTrim = String.prototype.trim;

function matches(pattern: RegExp, value: string): boolean {
  return apply(regexpExec, pattern, [value]) !== null;
}

const SLASH_COMMAND_PATTERN = /(?:^|<span\s+data-command="[^"]+">)\s*\/[a-z0-9_-]+/i;
const EXACT_ARTIFACT_PATH_PATTERN = /(?:^|[\s`"'(])\/?[\w./-]+\.(?:md|mdx|txt|json|ya?ml)\b/i;

/** Input payload for slash command artifact policy. */
export interface SlashCommandArtifactPolicyInput {
  messages: readonly unknown[];
  slashCommandArtifactPathSeen?: boolean;
}

/** Public API contract for slash command artifact policy. */
export interface SlashCommandArtifactPolicy {
  hasSlashCommand: boolean;
  hasExactArtifactPath: boolean;
  hasLoadSkill: boolean;
  hasInvokeAgent: boolean;
  shouldKeepReminder: boolean;
}

function isToolCallPart(
  part: unknown,
): part is { type: "tool-call"; toolCallId: string; toolName: string } {
  return (
    isRecord(part) &&
    part.type === "tool-call" &&
    typeof part.toolCallId === "string" &&
    typeof part.toolName === "string"
  );
}

function isToolResultPart(part: unknown): part is {
  type: "tool-result";
  toolCallId: string;
  toolName?: string;
  output?: unknown;
  result?: unknown;
} {
  return isRecord(part) && part.type === "tool-result" && typeof part.toolCallId === "string";
}

function isToolRoleMessage(message: unknown): message is {
  role: "tool";
  toolCallId?: string;
  toolName?: string;
  content: unknown;
} {
  return isRecord(message) && message.role === "tool" && "content" in message;
}

function parseJsonString(value: string): unknown {
  try {
    return parseJson(value);
  } catch {
    return value;
  }
}

function extractArtifactPathsFromUnknown(value: unknown): string[] {
  if (typeof value === "string") {
    return matches(EXACT_ARTIFACT_PATH_PATTERN, value) ? [value] : [];
  }

  if (arrayIsArray(value)) {
    return flatMapPrivateArray(value, (item) => extractArtifactPathsFromUnknown(item));
  }

  if (!isRecord(value)) {
    return [];
  }

  return flatMapPrivateArray(
    objectValues(value),
    (nestedValue) => extractArtifactPathsFromUnknown(nestedValue),
  );
}

function extractMessageTexts(content: unknown): string[] {
  if (typeof content === "string" && apply(stringTrim, content, []).length > 0) {
    return [content];
  }

  if (!arrayIsArray(content)) {
    return [];
  }

  return flatMapPrivateArray(
    content,
    (part) =>
      isRecord(part) && part.type === "text" && typeof part.text === "string" &&
        apply(stringTrim, part.text, []).length > 0
        ? [part.text]
        : [],
  );
}

function resolveToolName(
  toolCallNamesById: ReadonlyMap<string, string>,
  value: { toolName?: string; toolCallId?: string },
): string | undefined {
  if (typeof value.toolName === "string" && value.toolName.length > 0) {
    return value.toolName;
  }

  return typeof value.toolCallId === "string" ? toolCallNamesById.get(value.toolCallId) : undefined;
}

function hasToolCallOrResult(messages: readonly unknown[], toolName: string): boolean {
  return somePrivateArray(messages, (message) => {
    if (!isRecord(message) || !arrayIsArray(message.content)) {
      return false;
    }

    return somePrivateArray(message.content, (part) => {
      if (!isRecord(part) || typeof part.toolName !== "string") {
        return false;
      }

      return (part.type === "tool-call" || part.type === "tool-result") &&
        part.toolName === toolName;
    });
  });
}

function containsSlashCommand(messages: readonly unknown[]): boolean {
  return somePrivateArray(messages, (message) => {
    if (!isRecord(message) || message.role !== "user") {
      return false;
    }

    return somePrivateArray(
      extractMessageTexts(message.content),
      (text) => matches(SLASH_COMMAND_PATTERN, text),
    );
  });
}

function containsExactArtifactPath(messages: readonly unknown[]): boolean {
  const toolCallNamesById = createPrivateMap<string, string>();

  for (let messageIndex = 0; messageIndex < messages.length; messageIndex++) {
    if (!hasOwn(messages, messageIndex)) continue;
    const message = messages[messageIndex]!;
    if (!isRecord(message) || !arrayIsArray(message.content)) {
      continue;
    }

    for (let partIndex = 0; partIndex < message.content.length; partIndex++) {
      if (!hasOwn(message.content, partIndex)) continue;
      const part = message.content[partIndex];
      if (!isToolCallPart(part)) {
        continue;
      }

      toolCallNamesById.set(part.toolCallId, part.toolName);
    }
  }

  return somePrivateArray(messages, (message) => {
    if (!isRecord(message)) {
      return false;
    }

    if (message.role === "user") {
      return somePrivateArray(
        extractMessageTexts(message.content),
        (text) => matches(EXACT_ARTIFACT_PATH_PATTERN, text),
      );
    }

    if (isToolRoleMessage(message) && !arrayIsArray(message.content)) {
      const resolvedToolName = resolveToolName(toolCallNamesById, message);

      if (resolvedToolName !== "form_input") {
        return false;
      }

      const parsedContent = typeof message.content === "string"
        ? parseJsonString(message.content)
        : message.content;
      return containsExactArtifactPathValue(parsedContent);
    }

    if (!arrayIsArray(message.content)) {
      return false;
    }

    return somePrivateArray(message.content, (part) => {
      if (!isToolResultPart(part) || !isRecord(part)) {
        return false;
      }

      const resolvedToolName = resolveToolName(toolCallNamesById, part);

      if (resolvedToolName !== "form_input") {
        return false;
      }

      return containsExactArtifactPathValue(part.output) ||
        containsExactArtifactPathValue(part.result);
    });
  });
}

/** Contains exact artifact path value helper. */
export function containsExactArtifactPathValue(value: unknown): boolean {
  return extractArtifactPathsFromUnknown(value).length > 0;
}

/** Evaluate slash command artifact policy helper. */
export function evaluateSlashCommandArtifactPolicy(
  input: SlashCommandArtifactPolicyInput,
): SlashCommandArtifactPolicy {
  const hasSlashCommand = containsSlashCommand(input.messages);
  const hasExactArtifactPath = containsExactArtifactPath(input.messages) ||
    input.slashCommandArtifactPathSeen === true;
  const hasLoadSkill = hasToolCallOrResult(input.messages, "load_skill");
  const hasInvokeAgent = hasToolCallOrResult(input.messages, "invoke_agent");

  return {
    hasSlashCommand,
    hasExactArtifactPath,
    hasLoadSkill,
    hasInvokeAgent,
    shouldKeepReminder: hasSlashCommand && hasExactArtifactPath && hasLoadSkill && !hasInvokeAgent,
  };
}
