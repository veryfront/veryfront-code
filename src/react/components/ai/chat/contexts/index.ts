/**
 * Chat Contexts
 *
 * React contexts for the compound component system. Each context provides
 * state to a specific layer of the component tree.
 *
 * @module ai/react/components/chat/contexts
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
  useMessageContext,
  useMessageContextOptional,
} from "./message-context.tsx";

export {
  ComposerContextProvider,
  type ComposerContextValue,
  useComposerContext,
  useComposerContextOptional,
} from "./composer-context.tsx";

export {
  ThreadListContextProvider,
  type ThreadListContextValue,
  useThreadListContext,
  useThreadListContextOptional,
} from "./thread-list-context.tsx";
