/**
 * All browser-side components, hooks, and utilities.
 *
 * Convenience barrel that aggregates every browser-only export path.
 * Individual paths (veryfront/head, veryfront/chat, etc.) continue to work.
 *
 * @module react
 *
 * @example
 * ```tsx
 * import { Chat, useChat } from "veryfront/react";
 *
 * export default function Page() {
 *   const chat = useChat({ api: "/api/chat" });
 *   return <Chat messages={chat.messages} input={chat.input} onChange={chat.handleInputChange} onSubmit={chat.handleSubmit} />;
 * }
 * ```
 */

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
// Chat — Core preset + compound
// ---------------------------------------------------------------------------
export { Chat, ChatComponents } from "./components/ai/chat.tsx";
export type { ChatProps } from "./components/ai/chat.tsx";

// Chat — Composition building blocks
export {
  ChatComposer,
  ChatEmpty,
  ChatIf,
  ChatMessageList,
  ChatRoot,
  ErrorBanner,
  Message,
  ModelAvatar,
} from "./components/ai/chat.tsx";
export type {
  ChatComposerProps,
  ChatEmptyProps,
  ChatIfProps,
  ChatMessageListProps,
  ChatRootProps,
  ErrorBannerProps,
  MessageRootProps,
  ModelAvatarProps,
} from "./components/ai/chat.tsx";

// Chat — Contexts
export {
  ChatContextProvider,
  ComposerContextProvider,
  MessageContextProvider,
  ThreadListContextProvider,
  useChatContext,
  useChatContextOptional,
  useComposerContext,
  useComposerContextOptional,
  useMessageContext,
  useMessageContextOptional,
  useThreadListContext,
  useThreadListContextOptional,
} from "./components/ai/chat.tsx";
export type {
  ChatContextValue,
  ComposerContextValue,
  MessageContextValue,
  ThreadListContextValue,
} from "./components/ai/chat.tsx";

// Chat — Sub-components
export {
  AttachmentPill,
  BranchPicker,
  ChatSidebar,
  ChatWithSidebar,
  ConversationEmptyState,
  ConversationScrollButton,
  DocsPanel,
  downloadMarkdown,
  DropZoneOverlay,
  exportAsMarkdown,
  extractSourcesFromParts,
  FadeIn,
  getTextContent,
  groupPartsInOrder,
  InferenceBadge,
  InlineCitation,
  isReasoningPart,
  isToolPart,
  Loader,
  MessageActions,
  MessageEditForm,
  MessageFeedback,
  ModelSelector,
  QuickActions,
  ReasoningCard,
  RichCodeBlock,
  Shimmer,
  Sources,
  StepIndicator,
  Suggestion,
  Suggestions,
  TabSwitcher,
  ToolCallCard,
  ToolStatusBadge,
  UpgradeCTA,
  useThreads,
} from "./components/ai/chat.tsx";
export type {
  AttachmentInfo,
  AttachmentPillProps,
  BranchPickerProps,
  ChatSidebarProps,
  ChatTab,
  ChatWithSidebarProps,
  ConversationEmptyStateProps,
  ConversationScrollButtonProps,
  DocFile,
  DocsPanelProps,
  DropZoneOverlayProps,
  FeedbackValue,
  InferenceBadgeProps,
  InlineCitationProps,
  MessageActionsProps,
  MessageEditFormProps,
  MessageFeedbackProps,
  ModelOption,
  ModelSelectorProps,
  PartGroup,
  QuickAction,
  QuickActionsProps,
  Source,
  SourcesProps,
  StepIndicatorProps,
  SuggestionProps,
  SuggestionsProps,
  TabSwitcherProps,
  Thread,
  UpgradeCTAProps,
  UseThreadsOptions,
  UseThreadsResult,
} from "./components/ai/chat.tsx";

// Standalone message components
export { Message as StandaloneMessage, StreamingMessage } from "./components/ai/message.tsx";
export type { MessageProps, StreamingMessageProps } from "./components/ai/message.tsx";

export { AgentCard } from "./components/ai/agent-card.tsx";
export type { AgentCardProps } from "./components/ai/agent-card.tsx";

export { AIErrorBoundary, useAIErrorHandler } from "./components/ai/error-boundary.tsx";
export type { AIErrorBoundaryProps } from "./components/ai/error-boundary.tsx";

// Theme utilities
export type { AgentTheme, ChatTheme } from "./components/ai/theme.ts";
export {
  chatButtonVariants,
  chatContainerVariants,
  cn,
  cva,
  defaultAgentTheme,
  defaultChatTheme,
  mergeThemes,
  messageVariants,
  type VariantProps,
} from "./components/ai/theme.ts";
export {
  ColorModeProvider,
  type ColorModeProviderProps,
  ColorModeScript,
  ColorModeToggle,
  useColorMode,
} from "./components/ai/color-mode.tsx";

// Design tokens
export { chatTokens, getChatTokensCSS } from "./components/ai/chat-tokens.ts";
export {
  ChatStyleProvider,
  type ChatStyleProviderProps,
} from "./components/ai/chat-style-provider.tsx";

// ---------------------------------------------------------------------------
// Chat — hooks (veryfront/chat)
// ---------------------------------------------------------------------------
export { useChat } from "#veryfront/agent/react/use-chat/index.ts";
export type {
  BranchInfo,
  BrowserInferenceStatus,
  DynamicToolUIPart,
  InferenceMode,
  OnToolCallArg,
  ReasoningUIPart,
  StepUIPart,
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
