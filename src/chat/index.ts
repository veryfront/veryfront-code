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
} from "../react/components/ai/chat.tsx";
export type { ChatProps } from "../react/components/ai/chat.tsx";

export { Message, StreamingMessage } from "../react/components/ai/message.tsx";
export type { MessageProps, StreamingMessageProps } from "../react/components/ai/message.tsx";

export { AgentCard } from "../react/components/ai/agent-card.tsx";
export type { AgentCardProps } from "../react/components/ai/agent-card.tsx";

export { AIErrorBoundary, useAIErrorHandler } from "../react/components/ai/error-boundary.tsx";
export type { AIErrorBoundaryProps } from "../react/components/ai/error-boundary.tsx";

// Types only from theme — excludes cn, defaultChatTheme,
// defaultAgentTheme, mergeThemes
export type { AgentTheme, ChatTheme } from "../react/components/ai/theme.ts";

// ---------------------------------------------------------------------------
// Hooks (from agent/react)
// ---------------------------------------------------------------------------

export { useChat } from "../agent/react/use-chat/index.ts";
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
} from "../agent/react/use-chat/index.ts";

export { useAgent } from "../agent/react/use-agent.ts";
export type { UseAgentOptions, UseAgentResult } from "../agent/react/use-agent.ts";

export { useCompletion } from "../agent/react/use-completion.ts";
export type { UseCompletionOptions, UseCompletionResult } from "../agent/react/use-completion.ts";

export { useStreaming } from "../agent/react/use-streaming.ts";
export type { UseStreamingOptions, UseStreamingResult } from "../agent/react/use-streaming.ts";

export { useVoiceInput } from "../agent/react/use-voice-input.ts";
export type { UseVoiceInputOptions, UseVoiceInputResult } from "../agent/react/use-voice-input.ts";
