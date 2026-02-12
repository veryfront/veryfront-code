/**
 * Components - Ai
 *
 * @module react/components/ai
 */

export {
  type AgentTheme,
  type ChatTheme,
  cn,
  defaultAgentTheme,
  defaultChatTheme,
  mergeThemes,
} from "./theme.ts";

export { Chat, ChatComponents, ChatFooter, ChatHeader, ChatInput, ChatMessages, ModelSelector } from "./chat.tsx";
export type { ChatProps, ModelOption, ModelSelectorProps } from "./chat.tsx";

export { AgentCard } from "./agent-card.tsx";
export type { AgentCardProps } from "./agent-card.tsx";

export { Message, StreamingMessage } from "./message.tsx";
export type { MessageProps, StreamingMessageProps } from "./message.tsx";

export { Markdown } from "./markdown.tsx";
export type { CodeBlockProps, MarkdownProps } from "./markdown.tsx";

export { AIErrorBoundary, useAIErrorHandler } from "./error-boundary.tsx";
export type { AIErrorBoundaryProps } from "./error-boundary.tsx";
