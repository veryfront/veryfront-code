/**
 * Veryfront AI React Module
 *
 * Layer 1: Headless Hooks for AI interactions
 *
 * This module provides React hooks with complete control over AI logic
 * and zero UI opinions. Build any interface you want.
 *
 * @module veryfront/ai/react
 * @example
 * ```typescript
 * import { useChat } from 'veryfront/ai/react';
 *
 * function MyChat() {
 *   const { messages, input, setInput, append } = useChat({
 *     api: '/api/chat',
 *   });
 *
 *   return (
 *     <YourCompletelyCustomUI
 *       messages={messages}
 *       input={input}
 *       onChange={setInput}
 *       onSubmit={() => append({ role: 'user', content: input })}
 *     />
 *   );
 * }
 * ```
 */

// Export all hooks
export * from "./hooks/index.ts";
