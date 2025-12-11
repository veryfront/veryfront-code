/**
 * Layer 1: Headless Hooks
 *
 * React hooks for AI interactions with zero UI opinions.
 *
 * @module veryfront/ai/react
 */

export { useChat } from "./use-chat.ts";
export type {
  DynamicToolUIPart,
  OnToolCallArg,
  ReasoningUIPart,
  TextUIPart,
  ToolOutput,
  ToolResultUIPart,
  ToolState,
  ToolUIPart,
  // AI SDK v5 compatible types
  UIMessage,
  UIMessagePart,
  UseChatOptions,
  UseChatResult,
} from "./use-chat.ts";

export { useAgent } from "./use-agent.ts";
export type { UseAgentOptions, UseAgentResult } from "./use-agent.ts";

export { useCompletion } from "./use-completion.ts";
export type { UseCompletionOptions, UseCompletionResult } from "./use-completion.ts";

export { useStreaming } from "./use-streaming.ts";
export type { UseStreamingOptions, UseStreamingResult } from "./use-streaming.ts";

export { useVoiceInput } from "./use-voice-input.ts";
export type { UseVoiceInputOptions, UseVoiceInputResult } from "./use-voice-input.ts";
