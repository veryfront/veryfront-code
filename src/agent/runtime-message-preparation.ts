import { prepareProviderModelMessagesFromUiMessages } from "../chat/message-prep.ts";
import type { ChatUiMessage } from "../chat/types.ts";
import {
  type AgentRuntimeMessage,
  convertProviderMessagesToAgentRuntimeMessages,
} from "./agent-runtime-message-adapter.ts";
import {
  resolveRuntimeMessageFileUrls,
  type RuntimeFileUrlResolver,
} from "./runtime-message-file-url-refresh.ts";

const DEFAULT_EMPTY_CONVERSATION_PROMPT =
  "Please provide 3-4 specific suggestions for what I could build or improve based on the current project context.";

export type PrepareAgentRuntimeMessagesFromUiMessagesOptions = {
  messages: readonly ChatUiMessage[];
  emptyConversationPrompt?: string;
  resolveFileUrl?: RuntimeFileUrlResolver;
};

export async function prepareAgentRuntimeMessagesFromUiMessages(
  options: PrepareAgentRuntimeMessagesFromUiMessagesOptions,
): Promise<AgentRuntimeMessage[]> {
  if (isEmptyConversation(options.messages)) {
    return convertProviderMessagesToAgentRuntimeMessages([
      {
        role: "user",
        content: options.emptyConversationPrompt ?? DEFAULT_EMPTY_CONVERSATION_PROMPT,
      },
    ]);
  }

  const refreshedMessages = options.resolveFileUrl
    ? await resolveRuntimeMessageFileUrls(options.messages, options.resolveFileUrl)
    : [...options.messages];

  return convertProviderMessagesToAgentRuntimeMessages(
    prepareProviderModelMessagesFromUiMessages(refreshedMessages),
  );
}

function isEmptyConversation(messages: readonly ChatUiMessage[]): boolean {
  if (messages.length === 0) return true;

  if (messages.length === 1 && messages[0]?.role === "user") {
    const parts = messages[0].parts;
    if (parts.length === 0) return true;

    return parts.every((part) => {
      if (part.type === "text") {
        return !part.text || part.text.trim() === "";
      }
      return false;
    });
  }

  return false;
}
