// veryfront/react — All browser-side components, hooks, and utilities.
//
// Convenience barrel that aggregates every browser-only export path.
// Individual paths (veryfront/head, veryfront/chat, etc.) continue to work.

// ---------------------------------------------------------------------------
// Head (veryfront/head)
// ---------------------------------------------------------------------------
export { Head } from "./components/Head.tsx";

// ---------------------------------------------------------------------------
// Router (veryfront/router)
// ---------------------------------------------------------------------------
export { Link, RouterProvider, useRouter } from "./router/index.tsx";
export type { LinkProps, RouterProviderProps, RouterValue } from "./router/index.tsx";

// ---------------------------------------------------------------------------
// Context (veryfront/context)
// ---------------------------------------------------------------------------
export { PageContextProvider, usePageContext } from "./context/index.tsx";
export type { MdxHeading, PageContextProviderProps, PageContextValue } from "./context/index.tsx";

// ---------------------------------------------------------------------------
// Fonts (veryfront/fonts)
// ---------------------------------------------------------------------------
export { GoogleFonts } from "./fonts/index.ts";
export type { Font, GoogleFontsProps } from "./fonts/index.ts";

// ---------------------------------------------------------------------------
// Markdown (veryfront/markdown)
// ---------------------------------------------------------------------------
export { Markdown } from "./components/ai/markdown.tsx";
export type { CodeBlockProps, MarkdownProps } from "./components/ai/markdown.tsx";

// ---------------------------------------------------------------------------
// MDX (veryfront/mdx)
// ---------------------------------------------------------------------------
export { MDXProvider, useMDXComponents } from "./components/MDXProvider.tsx";
export type { MDXProviderProps } from "./components/MDXProvider.tsx";

// ---------------------------------------------------------------------------
// Chat — components (veryfront/chat)
// ---------------------------------------------------------------------------
export {
  Chat,
  ChatComponents,
  ChatFooter,
  ChatHeader,
  ChatInput,
  ChatMessages,
  extractSourcesFromParts,
  FadeIn,
  InlineCitation,
  ModelSelector,
  Sources,
} from "./components/ai/chat.tsx";
export type {
  ChatProps,
  InlineCitationProps,
  ModelOption,
  ModelSelectorProps,
  Source,
  SourcesProps,
} from "./components/ai/chat.tsx";

export { Message, StreamingMessage } from "./components/ai/message.tsx";
export type { MessageProps, StreamingMessageProps } from "./components/ai/message.tsx";

export { AgentCard } from "./components/ai/agent-card.tsx";
export type { AgentCardProps } from "./components/ai/agent-card.tsx";

export { AIErrorBoundary, useAIErrorHandler } from "./components/ai/error-boundary.tsx";
export type { AIErrorBoundaryProps } from "./components/ai/error-boundary.tsx";

export type { AgentTheme, ChatTheme } from "./components/ai/theme.ts";

// ---------------------------------------------------------------------------
// Chat — hooks (veryfront/chat)
// ---------------------------------------------------------------------------
export { useChat } from "#veryfront/agent/react/use-chat/index.ts";
export type {
  BrowserInferenceStatus,
  DynamicToolUIPart,
  InferenceMode,
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

// ---------------------------------------------------------------------------
// Documents (veryfront/embedding)
// ---------------------------------------------------------------------------
export { useDocuments } from "#veryfront/embedding/react/index.ts";
export type { UseDocumentsOptions, UseDocumentsResult } from "#veryfront/embedding/react/index.ts";
