import {
  type HistoricalToolInputRetentionOptions,
  prepareProviderModelMessagesFromUiMessages,
} from "../../chat/message-prep.ts";
import type { ChatUiMessage } from "../../chat/types.ts";
import {
  type AgentRuntimeMessage,
  convertProviderMessagesToAgentRuntimeMessages,
} from "./message-adapter.ts";
import {
  createRuntimeFileContentFetcher,
  inlineRuntimeMessageFileContents,
  resolveRuntimeMessageFileUrls,
  type RuntimeFileContentFetcher,
  type RuntimeFileUrlResolver,
} from "./message-file-url-refresh.ts";

const DEFAULT_EMPTY_CONVERSATION_PROMPT =
  "Please provide 3-4 specific suggestions for what I could build or improve based on the current project context.";

/** Options accepted by prepare agent runtime messages from UI messages. */
export type PrepareAgentRuntimeMessagesFromUiMessagesOptions = {
  messages: readonly ChatUiMessage[];
  emptyConversationPrompt?: string;
  resolveFileUrl?: RuntimeFileUrlResolver;
  fetchFileContent?: RuntimeFileContentFetcher;
  abortSignal?: AbortSignal;
  fileContentFetchTimeoutMs?: number;
  providerOwnedToolNames?: readonly string[];
  historicalToolInputRetention?: HistoricalToolInputRetentionOptions;
};

/** Prepare agent runtime messages from UI messages. */
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

  const trustedFileContentUrls = new Set<string>();
  const resolveFileUrl = options.resolveFileUrl;
  const refreshedMessages = resolveFileUrl
    ? await resolveRuntimeMessageFileUrls(options.messages, async (input) => {
      const url = await resolveFileUrl(input);
      if (url) {
        trustedFileContentUrls.add(url);
      }
      return url;
    })
    : [...options.messages];
  const messagesWithFileContent = await inlineRuntimeMessageFileContents(
    refreshedMessages,
    options.fetchFileContent ?? createRuntimeFileContentFetcher({
      trustedUrls: trustedFileContentUrls,
    }),
    {
      ...(options.abortSignal ? { abortSignal: options.abortSignal } : {}),
      ...(options.fileContentFetchTimeoutMs != null
        ? { fetchTimeoutMs: options.fileContentFetchTimeoutMs }
        : {}),
    },
  );

  return convertProviderMessagesToAgentRuntimeMessages(
    prepareProviderModelMessagesFromUiMessages(messagesWithFileContent, {
      providerOwnedToolNames: options.providerOwnedToolNames,
      historicalToolInputRetention: options.historicalToolInputRetention,
    }),
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
