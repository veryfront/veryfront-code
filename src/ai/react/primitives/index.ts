/**
 * Layer 2: Unstyled Primitives
 *
 * Composable UI primitives with zero styling opinions.
 * Built on Radix UI patterns (shadcn-compatible).
 *
 * @module veryfront/ai/primitives
 * @example
 * ```tsx
 * import {
 *   ChatContainer,
 *   MessageList,
 *   MessageItem,
 *   InputBox,
 * } from 'veryfront/ai/primitives';
 * import { useChat } from 'veryfront/ai/react';
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
 *             {msg.content}
 *           </MessageItem>
 *         ))}
 *       </MessageList>
 *       <InputBox
 *         value={chat.input}
 *         onChange={chat.handleInputChange}
 *         onSubmit={() => chat.append({ role: 'user', content: chat.input })}
 *         className="border-t p-4"
 *       />
 *     </ChatContainer>
 *   );
 * }
 * ```
 */

// Chat primitives
export * from "./chat-container.tsx";
export * from "./message-list.tsx";
export * from "./input-box.tsx";

// Agent primitives
export * from "./agent-primitives.tsx";

// Tool primitives
export * from "./tool-primitives.tsx";
