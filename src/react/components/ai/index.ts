/**
 * Layer 3: Styled Components
 *
 * Production-ready, fully styled components.
 * Built on Layer 2 primitives.
 *
 * @module veryfront/components/ai
 * @example
 * ```tsx
 * import { Chat } from 'veryfront/components/ai';
 * import { useChat } from 'veryfront/agent/react';
 *
 * export default function ChatPage() {
 *   const chat = useChat({ api: '/api/chat' });
 *   return <Chat {...chat} />;
 * }
 * ```
 */

export * from "./theme.ts";

export { Chat, ChatComponents } from "./chat.tsx";
export type { ChatProps } from "./chat.tsx";

export { AgentCard } from "./agent-card.tsx";
export type { AgentCardProps } from "./agent-card.tsx";

export { Message, StreamingMessage } from "./message.tsx";
export type { MessageProps, StreamingMessageProps } from "./message.tsx";

export { Markdown } from "./markdown.tsx";
export type { CodeBlockProps, MarkdownProps } from "./markdown.tsx";

export { AIErrorBoundary, useAIErrorHandler } from "./error-boundary.tsx";
export type { AIErrorBoundaryProps } from "./error-boundary.tsx";
