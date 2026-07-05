/**
 * Chat Composition API — All composable building blocks for chat UIs.
 *
 * @module react/components/chat/composition/api
 */

// Root / Layout
export { ChatRoot, type ChatRootProps } from "./chat-root.tsx";
export { ChatMessageList, type ChatMessageListProps } from "./chat-message-list.tsx";
export { ChatInput, type ChatInputProps } from "./chat-composer.tsx";
export { ChatEmpty, type ChatEmptyProps } from "./chat-empty.tsx";
export {
  ChatEmptyState,
  type ChatEmptyStateAvatarProps,
  type ChatEmptyStateHeadingProps,
  type ChatEmptyStateRootProps,
  type ChatEmptyStateSuggestionProps,
  type ChatEmptyStateSuggestionsProps,
} from "./chat-empty-state.tsx";
export { ChatIf, type ChatIfProps } from "./chat-if.tsx";
export { AgentAvatar, type AgentAvatarProps } from "./agent-avatar.tsx";
export { ModelAvatar, type ModelAvatarProps } from "./model-avatar.tsx";
export { ErrorBanner, type ErrorBannerProps } from "./error-banner.tsx";
export { PendingMessage, type PendingMessageProps } from "./pending-message.tsx";

// Message — render-or-compose (`<Message />` or `Message.Root` + parts)
export { Message, type MessageProps, type MessageRootProps } from "./message.tsx";
