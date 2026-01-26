/**
 * Agent React Hooks - Layer 1 (Headless)
 *
 * React hooks for AI interactions with zero UI opinions.
 *
 * @module veryfront/agent/react
 */
import "../../../_dnt.polyfills.js";


export { useChat } from "./use-chat/index.js";
export type {
  DynamicToolUIPart,
  OnToolCallArg,
  ReasoningUIPart,
  TextUIPart,
  ToolOutput,
  ToolResultUIPart,
  ToolState,
  ToolUIPart,
  UIMessage,
  UIMessagePart,
  UseChatOptions,
  UseChatResult,
} from "./use-chat/index.js";

export { useAgent } from "./use-agent.js";
export type { UseAgentOptions, UseAgentResult } from "./use-agent.js";

export { useCompletion } from "./use-completion.js";
export type { UseCompletionOptions, UseCompletionResult } from "./use-completion.js";

export { useStreaming } from "./use-streaming.js";
export type { UseStreamingOptions, UseStreamingResult } from "./use-streaming.js";

export { useVoiceInput } from "./use-voice-input.js";
export type { UseVoiceInputOptions, UseVoiceInputResult } from "./use-voice-input.js";
