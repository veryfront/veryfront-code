/**
 * Layer 1: Headless Hooks
 *
 * React hooks for AI interactions with zero UI opinions.
 *
 * @module veryfront/ai/react
 */

export { useChat } from "./use-chat.ts";
export type { UseChatOptions, UseChatResult } from "./use-chat.ts";

export { useAgent } from "./use-agent.ts";
export type { UseAgentOptions, UseAgentResult } from "./use-agent.ts";

export { useCompletion } from "./use-completion.ts";
export type { UseCompletionOptions, UseCompletionResult } from "./use-completion.ts";

export { useStreaming } from "./use-streaming.ts";
export type { UseStreamingOptions, UseStreamingResult } from "./use-streaming.ts";
