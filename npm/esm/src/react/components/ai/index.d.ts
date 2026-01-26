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
import "../../../../_dnt.polyfills.js";
export * from "./theme.js";
export { Chat, ChatComponents } from "./chat.js";
export type { ChatProps } from "./chat.js";
export { AgentCard } from "./agent-card.js";
export type { AgentCardProps } from "./agent-card.js";
export { Message, StreamingMessage } from "./message.js";
export type { MessageProps, StreamingMessageProps } from "./message.js";
export { Markdown } from "./markdown.js";
export type { CodeBlockProps, MarkdownProps } from "./markdown.js";
export { AIErrorBoundary, useAIErrorHandler } from "./error-boundary.js";
export type { AIErrorBoundaryProps } from "./error-boundary.js";
//# sourceMappingURL=index.d.ts.map