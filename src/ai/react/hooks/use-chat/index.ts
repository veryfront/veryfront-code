/**
 * useChat Hook Module
 *
 * Layer 1 (Headless) - Complete chat state management with zero UI.
 *
 * @module ai/react/hooks/use-chat
 */

// Main hook
export { useChat } from "./hook.ts";

// Types
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
} from "./types.ts";

// Utilities
export { createAssistantMessage, generateClientId } from "./utils.ts";

// Streaming
export { handleStreamingResponse } from "./streaming/handler.ts";
export type { StreamingCallbacks } from "./streaming/types.ts";
