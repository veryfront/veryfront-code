import type { Message } from "../types.ts";
import type { ProviderModelMessage } from "#veryfront/chat/types.ts";
import { markToolResultSources } from "#veryfront/chat/tool-result-source.ts";
import { withProviderModelMessageSourceId } from "#veryfront/chat/conversation.ts";
import { appendPrivateArray } from "#veryfront/security/private-array.ts";
import { convertAgentRuntimeMessagesToProviderMessages } from "./message-adapter.ts";

/** Preserve original history identity while projecting messages for a provider. */
export function convertRuntimeMessagesToProviderMessagesWithSource(
  messages: readonly Message[],
): ProviderModelMessage[] {
  const converted: ProviderModelMessage[] = [];
  for (let index = 0; index < messages.length; index++) {
    if (!Object.hasOwn(messages, index)) continue;
    const message = messages[index]!;
    const providerMessages = convertAgentRuntimeMessagesToProviderMessages([message]);
    for (let providerIndex = 0; providerIndex < providerMessages.length; providerIndex++) {
      if (!Object.hasOwn(providerMessages, providerIndex)) continue;
      const providerMessage = withProviderModelMessageSourceId(
        providerMessages[providerIndex]!,
        message.id,
      );
      if (providerMessage.role === "tool") {
        markToolResultSources(providerMessage.content, message.id);
      }
      appendPrivateArray(converted, [providerMessage]);
    }
  }
  return converted;
}
