/**
 * Client-only AI SDK exports
 *
 * This module exports React hooks from AI SDK that can only be used in browser environments.
 * These hooks require browser-specific APIs and should not be bundled for server-side code.
 *
 * @module ai/client
 */

// Re-export AI SDK React hooks (battle-tested, proven in production)
// These are client-only and require browser environment
export { useChat, useCompletion } from "ai/react";

// Re-export core types that are useful on the client
export type { UseChatOptions, UseCompletionOptions } from "ai/react";
