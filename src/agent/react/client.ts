/**
 * Client-only AI SDK exports
 *
 * This module exports React hooks from AI SDK that can only be used in browser environments.
 * These hooks require browser-specific APIs and should not be bundled for server-side code.
 *
 * @module veryfront/agent/react/client
 */

export { useChat, useCompletion } from "ai/react";
export type { UseChatOptions, UseCompletionOptions } from "ai/react";
