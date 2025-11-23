/**
 * Layer 3: Styled Components
 *
 * Production-ready, fully styled components.
 * Built on Layer 2 primitives.
 *
 * @module veryfront/ai/components
 * @example
 * ```tsx
 * import { Chat } from 'veryfront/ai/components';
 * import { useChat } from 'veryfront/ai/react';
 *
 * export default function ChatPage() {
 *   const chat = useChat({ api: '/api/chat' });
 *   return <Chat {...chat} />;
 * }
 * ```
 */

// Theme system
export * from "./theme.ts";

// Styled components
export { Chat, ChatComponents } from "./chat.tsx";
export type { ChatProps } from "./chat.tsx";

export { AgentCard } from "./agent-card.tsx";
export type { AgentCardProps } from "./agent-card.tsx";

export { Message, StreamingMessage } from "./message.tsx";
export type { MessageProps, StreamingMessageProps } from "./message.tsx";

// Error boundary
export { AIErrorBoundary, useAIErrorHandler } from "./error-boundary.tsx";
export type { AIErrorBoundaryProps } from "./error-boundary.tsx";
