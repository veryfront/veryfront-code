/**
 * Layer 2: Unstyled Primitives
 *
 * Composable UI primitives with zero styling opinions.
 * Built on Radix UI patterns (shadcn-compatible).
 *
 * Uses AI SDK v5 UI Message format with parts-based content structure.
 *
 * @module veryfront/primitives
 * @example
 * ```tsx
 * import {
 *   ChatContainer,
 *   MessageList,
 *   MessageItem,
 *   InputBox,
 * } from 'veryfront/primitives';
 * import { useChat } from 'veryfront/agent/react';
 * import type { UIMessage } from 'veryfront/agent/react';
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
 *   const chat = useChat({ api: '/api/chat' });
 *
 *   return (
 *     <ChatContainer className="flex flex-col h-screen">
 *       <MessageList className="flex-1 overflow-y-auto">
 *         {chat.messages.map((msg) => (
 *           <MessageItem
 *             key={msg.id}
 *             role={msg.role}
 *             className="p-4"
 *           >
 *             {getTextContent(msg)}
 *           </MessageItem>
 *         ))}
 *       </MessageList>
 *       <form onSubmit={chat.handleSubmit}>
 *         <InputBox
 *           value={chat.input}
 *           onChange={chat.handleInputChange}
 *           className="border-t p-4"
 *         />
 *       </form>
 *     </ChatContainer>
 *   );
 * }
 * ```
 */
import "../../../_dnt.polyfills.js";
export * from "./chat-container.js";
export * from "./message-list.js";
export * from "./input-box.js";
export * from "./agent-primitives.js";
export * from "./tool-primitives.js";
//# sourceMappingURL=index.d.ts.map