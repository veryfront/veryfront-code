/**
 * Chat Contexts
 *
 * React contexts for the compound component system. Each context provides
 * state to a specific layer of the component tree.
 *
 * @module react/components/chat/contexts
 */

export {
  ChatContextProvider,
  type ChatContextValue,
  useChatContext,
  useChatContextOptional,
} from "./chat-context.tsx";

export {
  MessageContextProvider,
  type MessageContextValue,
  type MessagePartsData,
  useMessageBranches,
  type UseMessageBranchesResult,
  useMessageContext,
  useMessageContextOptional,
  useMessageParts,
} from "./message-context.tsx";

export {
  ChatInputContextProvider,
  type ChatInputContextValue,
  useChatInputContext,
  useChatInputContextOptional,
} from "./composer-context.tsx";

export {
  ConversationsContextProvider,
  ConversationsProvider,
  type ConversationsProviderProps,
  useConversationsContext,
  useConversationsContextOptional,
} from "./conversations-context.tsx";
