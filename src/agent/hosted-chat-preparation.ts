import type { ChatRequestContext, ChatUiMessage } from "#veryfront/chat/types.ts";
import type { AgentRuntimeMessage } from "./agent-runtime-message-adapter.ts";
import type { ParsedHostedChatRequest } from "./hosted-chat-request-parser.ts";
import {
  prepareAgentRuntimeMessagesFromUiMessages,
  type PrepareAgentRuntimeMessagesFromUiMessagesOptions,
} from "./runtime-message-preparation.ts";
import { getRuntimeUploadUrl } from "./runtime-upload-url-client.ts";

export type NormalizedHostedChatRequest = {
  effectiveMessages: ChatUiMessage[];
  effectiveValidatedContext: ChatRequestContext;
  parentMessageId: string | undefined;
};

export type PrepareHostedChatRuntimeMessagesOptions =
  & Pick<
    PrepareAgentRuntimeMessagesFromUiMessagesOptions,
    "emptyConversationPrompt"
  >
  & {
    authToken?: string;
    apiUrl?: string | URL;
    projectId?: string | null;
  };

export function normalizeParsedHostedChatRequest(
  request: ParsedHostedChatRequest,
): NormalizedHostedChatRequest {
  const effectiveMessages = request.messages;
  const validatedContext = request.validatedContext;
  const conversationId = validatedContext.conversationId ?? request.conversationId;
  const effectiveValidatedContext: ChatRequestContext = {
    ...validatedContext,
    projectId: validatedContext.projectId ?? request.projectId,
    branchId: validatedContext.branchId ?? null,
    ...(conversationId ? { conversationId } : {}),
  };

  return {
    effectiveMessages,
    effectiveValidatedContext,
    parentMessageId: effectiveMessages.findLast((message) => message.role === "user")?.id,
  };
}

export async function prepareHostedChatRuntimeMessages(
  messages: readonly ChatUiMessage[],
  options: PrepareHostedChatRuntimeMessagesOptions = {},
): Promise<AgentRuntimeMessage[]> {
  if (!options.authToken || !options.apiUrl) {
    return await prepareAgentRuntimeMessagesFromUiMessages({
      messages,
      emptyConversationPrompt: options.emptyConversationPrompt,
    });
  }
  const authToken = options.authToken;
  const apiUrl = options.apiUrl;

  return await prepareAgentRuntimeMessagesFromUiMessages({
    messages,
    emptyConversationPrompt: options.emptyConversationPrompt,
    resolveFileUrl: ({ uploadId }) =>
      getRuntimeUploadUrl({
        apiUrl,
        authToken,
        uploadId,
        projectId: options.projectId,
      }),
  });
}
