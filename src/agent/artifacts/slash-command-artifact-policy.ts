import { isRecord } from "#veryfront/chat/conversation.ts";

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
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function extractArtifactPathsFromUnknown(value: unknown): string[] {
  if (typeof value === "string") {
    return EXACT_ARTIFACT_PATH_PATTERN.test(value) ? [value] : [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => extractArtifactPathsFromUnknown(item));
  }

  if (!isRecord(value)) {
    return [];
  }

  return Object.values(value).flatMap((nestedValue) =>
    extractArtifactPathsFromUnknown(nestedValue)
  );
}

function extractMessageTexts(content: unknown): string[] {
  if (typeof content === "string" && content.trim().length > 0) {
    return [content];
  }

  if (!Array.isArray(content)) {
    return [];
  }

  return content.flatMap((part) =>
    isRecord(part) && part.type === "text" && typeof part.text === "string" &&
      part.text.trim().length > 0
      ? [part.text]
      : []
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
  return messages.some((message) => {
    if (!isRecord(message) || !Array.isArray(message.content)) {
      return false;
    }

    return message.content.some((part) => {
      if (!isRecord(part) || typeof part.toolName !== "string") {
        return false;
      }

      return (part.type === "tool-call" || part.type === "tool-result") &&
        part.toolName === toolName;
    });
  });
}

function containsSlashCommand(messages: readonly unknown[]): boolean {
  return messages.some((message) => {
    if (!isRecord(message) || message.role !== "user") {
      return false;
    }

    return extractMessageTexts(message.content).some((text) => SLASH_COMMAND_PATTERN.test(text));
  });
}

function containsExactArtifactPath(messages: readonly unknown[]): boolean {
  const toolCallNamesById = new Map<string, string>();

  for (const message of messages) {
    if (!isRecord(message) || !Array.isArray(message.content)) {
      continue;
    }

    for (const part of message.content) {
      if (!isToolCallPart(part)) {
        continue;
      }

      toolCallNamesById.set(part.toolCallId, part.toolName);
    }
  }

  return messages.some((message) => {
    if (!isRecord(message)) {
      return false;
    }

    if (message.role === "user") {
      return extractMessageTexts(message.content).some((text) =>
        EXACT_ARTIFACT_PATH_PATTERN.test(text)
      );
    }

    if (isToolRoleMessage(message) && !Array.isArray(message.content)) {
      const resolvedToolName = resolveToolName(toolCallNamesById, message);

      if (resolvedToolName !== "form_input") {
        return false;
      }

      const parsedContent = typeof message.content === "string"
        ? parseJsonString(message.content)
        : message.content;
      return containsExactArtifactPathValue(parsedContent);
    }

    if (!Array.isArray(message.content)) {
      return false;
    }

    return message.content.some((part) => {
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
