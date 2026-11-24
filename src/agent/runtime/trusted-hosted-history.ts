import type { Message } from "../types.ts";
import type { RuntimeRunAgentInput } from "#veryfront/internal-agents/schema.ts";
import { createPrivateMap } from "#veryfront/security/private-map.ts";
import {
  inheritTrustedHostedHistorySourceIdentity,
  inheritTrustedPlatformPolicyMessageMetadata,
  inheritTrustedPlatformPolicyToolResultMetadata,
  restoreTrustedHostedPlatformPolicyResultsFromServerHistory,
} from "./skill-policy-enforcement.ts";

function isTrustedHostedPolicyMetadataRole(
  role: RuntimeRunAgentInput["messages"][number]["role"] | Message["role"],
): role is "assistant" | "tool" {
  return role === "assistant" || role === "tool";
}

function restoreTrustedHostedPolicyMetadataFromAgUiMessages<TMessage extends Message>(
  runtimeMessages: readonly TMessage[],
  sourceMessages: RuntimeRunAgentInput["messages"],
  trustedSourceMessageIds: readonly string[] | undefined,
): TMessage[] {
  if (!trustedSourceMessageIds || trustedSourceMessageIds.length === 0) {
    return [...runtimeMessages];
  }
  const trustedSourceIds = createPrivateMap<string, true>();
  for (let index = 0; index < trustedSourceMessageIds.length; index++) {
    if (!Object.hasOwn(trustedSourceMessageIds, index)) continue;
    const messageId = trustedSourceMessageIds[index];
    if (typeof messageId === "string") trustedSourceIds.set(messageId, true);
  }
  const sourceById = createPrivateMap<string, RuntimeRunAgentInput["messages"][number] | null>();
  for (let index = 0; index < sourceMessages.length; index++) {
    if (!Object.hasOwn(sourceMessages, index)) continue;
    const message = sourceMessages[index]!;
    if (!message.id || !trustedSourceIds.has(message.id)) continue;
    if (sourceById.has(message.id) || !isTrustedHostedPolicyMetadataRole(message.role)) {
      sourceById.set(message.id, null);
    } else {
      sourceById.set(message.id, message);
    }
  }

  const restoredMessages: TMessage[] = [];
  for (let index = 0; index < runtimeMessages.length; index++) {
    if (!Object.hasOwn(runtimeMessages, index)) continue;
    const message = runtimeMessages[index]!;
    const sourceMessage = sourceById.get(message.id);
    const restoredMessage = message.role === "tool"
      ? inheritTrustedPlatformPolicyToolResultMetadata(message, (id) => sourceById.get(id))
      : sourceMessage && message.role === sourceMessage.role &&
          isTrustedHostedPolicyMetadataRole(message.role)
      ? inheritTrustedPlatformPolicyMessageMetadata(sourceMessage, message)
      : message;
    restoredMessages[restoredMessages.length] = sourceMessage
      ? inheritTrustedHostedHistorySourceIdentity(sourceMessage, restoredMessage)
      : restoredMessage;
  }
  return restoredMessages;
}

export function restoreTrustedHostedRuntimeHistory<TMessage extends Message>(
  runtimeMessages: readonly TMessage[],
  sourceMessages: RuntimeRunAgentInput["messages"],
  trustedSourceMessageIds: readonly string[] | undefined,
): TMessage[] {
  const trustedRuntimeMessages = restoreTrustedHostedPolicyMetadataFromAgUiMessages(
    runtimeMessages,
    sourceMessages,
    trustedSourceMessageIds,
  );
  restoreTrustedHostedPlatformPolicyResultsFromServerHistory(trustedRuntimeMessages, {
    trustedMessageIds: trustedSourceMessageIds,
    sourceMessages,
  });
  return trustedRuntimeMessages;
}
