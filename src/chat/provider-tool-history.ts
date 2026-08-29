import { getStringField } from "./conversation.ts";
import type { ChatUiMessage } from "./types.ts";

export function getMessagePartToolCallId(part: unknown): string | undefined {
  if (!part || typeof part !== "object" || Array.isArray(part)) return undefined;

  return getStringField(part, "toolCallId", "") ||
    getStringField(part, "tool_call_id", "") ||
    getStringField(part, "id", "") ||
    undefined;
}

export function getMessagePartToolName(part: unknown): string | undefined {
  if (!part || typeof part !== "object" || Array.isArray(part)) return undefined;

  const record = part as Record<string, unknown>;
  const explicitToolName = getStringField(part, "toolName", "") ||
    getStringField(part, "tool_name", "") ||
    getStringField(part, "name", "") ||
    undefined;
  if (explicitToolName) return explicitToolName;

  const type = typeof record.type === "string" ? record.type : undefined;
  return type?.startsWith("tool-") && type !== "tool-call" && type !== "tool-result"
    ? type.replace(/^tool-/, "")
    : undefined;
}

export function stripProviderOwnedToolParts(
  messages: ChatUiMessage[],
  providerOwnedToolNames: readonly string[] | undefined,
  preserveSourceMessageIds: readonly string[] | undefined,
): ChatUiMessage[] {
  if (!providerOwnedToolNames || providerOwnedToolNames.length === 0) {
    return messages;
  }

  const providerOwnedNames = new Set(providerOwnedToolNames);
  const preservedMessageIds = new Set(preserveSourceMessageIds ?? []);
  const preservedToolCallIds = new Set<string>();
  for (const message of messages) {
    if (!preservedMessageIds.has(message.id)) continue;
    for (const part of message.parts) {
      const toolName = getMessagePartToolName(part);
      const toolCallId = getMessagePartToolCallId(part);
      if (toolCallId && toolName && providerOwnedNames.has(toolName)) {
        preservedToolCallIds.add(toolCallId);
      }
    }
  }
  const providerOwnedToolCallIds = new Set<string>();

  return messages.map((message) => {
    if (message.role === "user" || message.role === "system") {
      providerOwnedToolCallIds.clear();
      return message;
    }

    let mutated = false;
    const parts = message.parts.filter((part) => {
      const toolName = getMessagePartToolName(part);
      const toolCallId = getMessagePartToolCallId(part);
      const ownedByName = toolName ? providerOwnedNames.has(toolName) : false;
      const ownedByCallId = toolCallId ? providerOwnedToolCallIds.has(toolCallId) : false;

      if (toolCallId && preservedToolCallIds.has(toolCallId)) {
        return true;
      }
      if (!ownedByName && !ownedByCallId) {
        return true;
      }

      if (toolCallId) {
        providerOwnedToolCallIds.add(toolCallId);
      }
      mutated = true;
      return false;
    });

    return mutated ? { ...message, parts } : message;
  });
}
