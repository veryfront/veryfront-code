/**
 * Chat Composition API — All composable building blocks for chat UIs.
 *
 * @module ai/react/components/chat/composition/api
 */

// Root / Layout
export { ChatRoot, type ChatRootProps } from "./chat-root.tsx";
export { ChatMessageList, type ChatMessageListProps } from "./chat-message-list.tsx";
export { ChatComposer, type ChatComposerProps } from "./chat-composer.tsx";
export { ChatEmpty, type ChatEmptyProps } from "./chat-empty.tsx";
export { ChatIf, type ChatIfProps } from "./chat-if.tsx";
export { ModelAvatar, type ModelAvatarProps } from "./model-avatar.tsx";
export { ErrorBanner, type ErrorBannerProps } from "./error-banner.tsx";

// Message compound
export { Message, type MessageRootProps } from "./message.tsx";
