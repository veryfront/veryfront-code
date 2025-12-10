/**
 * Veryfront AI React Module
 *
 * Layer 1: Headless Hooks for AI interactions
 *
 * This module provides React hooks with complete control over AI logic
 * and zero UI opinions. Build any interface you want.
 *
 * Uses AI SDK v5 UI Message format with parts-based content structure.
 *
 * @module veryfront/ai/react
 * @example
 * ```typescript
 * import { useChat } from 'veryfront/ai/react';
 * import type { UIMessage } from 'veryfront/ai/react';
 *
 * // Helper to extract text from v5 parts array
 * function getTextContent(message: UIMessage): string {
 *   return message.parts
 *     .filter((p) => p.type === 'text')
 *     .map((p) => p.text)
 *     .join('');
 * }
 *
 * function MyChat() {
 *   const { messages, input, setInput, sendMessage, handleSubmit } = useChat({
 *     api: '/api/chat',
 *   });
 *
 *   return (
 *     <div>
 *       {messages.map((msg) => (
 *         <div key={msg.id}>{getTextContent(msg)}</div>
 *       ))}
 *       <form onSubmit={handleSubmit}>
 *         <input value={input} onChange={(e) => setInput(e.target.value)} />
 *         <button type="submit">Send</button>
 *       </form>
 *     </div>
 *   );
 * }
 * ```
 */

// Export all hooks
export * from "./hooks/index.ts";
