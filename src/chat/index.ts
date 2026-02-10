/**
 * Chat
 *
 * @module chat
 */

// veryfront/chat — Chat UI components + hooks
//
// Merges components/ai (UI) and agent/react (hooks) into a single
// product-oriented import path. Uses selective re-exports from
// individual source files to avoid leaking theme internals
// (cn, defaultChatTheme, defaultAgentTheme, mergeThemes).

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

export {
  Chat,
  ChatComponents,
  ChatFooter,
  ChatHeader,
  ChatInput,
  ChatMessages,
} from "#veryfront/react/components/ai/chat.tsx";
export type { ChatProps } from "#veryfront/react/components/ai/chat.tsx";

export { Message, StreamingMessage } from "#veryfront/react/components/ai/message.tsx";
export type {
  MessageProps,
  StreamingMessageProps,
} from "#veryfront/react/components/ai/message.tsx";

export { AgentCard } from "#veryfront/react/components/ai/agent-card.tsx";
export type { AgentCardProps } from "#veryfront/react/components/ai/agent-card.tsx";

export {
  AIErrorBoundary,
  useAIErrorHandler,
} from "#veryfront/react/components/ai/error-boundary.tsx";
export type { AIErrorBoundaryProps } from "#veryfront/react/components/ai/error-boundary.tsx";

// Types only from theme — excludes cn, defaultChatTheme,
// defaultAgentTheme, mergeThemes
export type { AgentTheme, ChatTheme } from "#veryfront/react/components/ai/theme.ts";

// ---------------------------------------------------------------------------
// Hooks (from agent/react)
// ---------------------------------------------------------------------------

export { useChat } from "#veryfront/agent/react/use-chat/index.ts";
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
} from "#veryfront/agent/react/use-chat/index.ts";

export { useAgent } from "#veryfront/agent/react/use-agent.ts";
export type { UseAgentOptions, UseAgentResult } from "#veryfront/agent/react/use-agent.ts";

export { useCompletion } from "#veryfront/agent/react/use-completion.ts";
export type {
  UseCompletionOptions,
  UseCompletionResult,
} from "#veryfront/agent/react/use-completion.ts";

export { useStreaming } from "#veryfront/agent/react/use-streaming.ts";
export type {
  UseStreamingOptions,
  UseStreamingResult,
} from "#veryfront/agent/react/use-streaming.ts";

export { useVoiceInput } from "#veryfront/agent/react/use-voice-input.ts";
export type {
  UseVoiceInputOptions,
  UseVoiceInputResult,
} from "#veryfront/agent/react/use-voice-input.ts";
