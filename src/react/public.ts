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
 *   const chat = useChat();
 *   return <Chat chat={chat} />;
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
export { Markdown } from "./components/chat/markdown.tsx";
export type { CodeBlockProps, MarkdownProps } from "./components/chat/markdown.tsx";

// ---------------------------------------------------------------------------
// MDX (veryfront/mdx)
// ---------------------------------------------------------------------------
export { MDXProvider, useMDXComponents } from "./components/MDXProvider.tsx";
export type { MDXProviderProps } from "./components/MDXProvider.tsx";

// ---------------------------------------------------------------------------
// Chat — Core preset + compound
// ---------------------------------------------------------------------------
export { Chat } from "./components/chat/chat.tsx";
export type { ChatAgentInfo, ChatProps } from "./components/chat/chat.tsx";

// Chat — Composition building blocks
export {
  ChatEmpty,
  ChatIf,
  ChatInput,
  ChatMessageList,
  ChatRoot,
  ErrorBanner,
  Message,
  type MessageProps,
  ModelAvatar,
} from "./components/chat/chat.tsx";
export type {
  ChatEmptyProps,
  ChatIfProps,
  ChatInputExportProps,
  ChatInputProps,
  ChatMessageListContentProps,
  ChatMessageListProps,
  ChatRootProps,
  ErrorBannerProps,
  MessageRootProps,
  MessageTokensProps,
  ModelAvatarProps,
  TokenRowProps,
} from "./components/chat/chat.tsx";

// Chat — Contexts
export {
  ChatContextProvider,
  ComposerContextProvider,
  MessageContextProvider,
  useChatContext,
  useChatContextOptional,
  useComposerContext,
  useComposerContextOptional,
  useMessageContext,
  useMessageContextOptional,
  useMessageParts,
} from "./components/chat/chat.tsx";
export type {
  ChatContextValue,
  ComposerContextValue,
  MessageContextValue,
  MessagePartsData,
} from "./components/chat/chat.tsx";

// Chat — Sub-components
export {
  AttachmentPill,
  AttachmentsPanel,
  BranchPicker,
  ChatSidebar,
  ConversationEmptyState,
  ConversationScrollButton,
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
  MessageActionBar,
  MessageEditForm,
  MessageFeedback,
  ModelSelector,
  QuickActions,
  RichCodeBlock,
  Shimmer,
  Sources,
  StepIndicator,
  Suggestion,
  Suggestions,
  TabSwitcher,
  ToolStatusBadge,
} from "./components/chat/chat.tsx";
export type {
  AttachmentInfo,
  AttachmentPillProps,
  AttachmentsPanelProps,
  BranchPickerActionProps,
  BranchPickerCountProps,
  BranchPickerProps,
  ChatSidebarComponent,
  ChatSidebarEmptyProps,
  ChatSidebarGroupProps,
  ChatSidebarItemProps,
  ChatSidebarListProps,
  ChatSidebarNewButtonProps,
  ChatSidebarProps,
  ChatSidebarRootProps,
  ChatTab,
  ConversationEmptyStateProps,
  ConversationScrollButtonProps,
  DropZoneOverlayProps,
  FeedbackValue,
  InferenceBadgeProps,
  InlineCitationCardProps,
  InlineCitationProps,
  InlineCitationTriggerProps,
  MessageActionBarActionProps,
  MessageActionBarProps,
  MessageEditFormProps,
  MessageFeedbackActionProps,
  MessageFeedbackProps,
  ModelOption,
  ModelSelectorProps,
  ModelSelectorSearchProps,
  PartGroup,
  QuickAction,
  QuickActionsProps,
  Source,
  SourcesProps,
  StepIndicatorProps,
  SuggestionProps,
  SuggestionsProps,
  TabSwitcherProps,
  UploadedFile,
} from "./components/chat/chat.tsx";

export { AgentCard } from "./components/chat/agent-card.tsx";
export type { AgentCardProps } from "./components/chat/agent-card.tsx";

export { ChatErrorBoundary, useChatErrorHandler } from "./components/chat/error-boundary.tsx";
export type { ChatErrorBoundaryProps } from "./components/chat/error-boundary.tsx";

// Theme utilities
export type { AgentTheme, ChatTheme } from "./components/chat/theme.ts";
export {
  chatButtonVariants,
  chatContainerVariants,
  cn,
  defaultAgentTheme,
  defaultChatTheme,
  mergeThemes,
  messageVariants,
} from "./components/chat/theme.ts";
export {
  ColorModeProvider,
  type ColorModeProviderProps,
  ColorModeScript,
  ColorModeToggle,
  useColorMode,
} from "./components/ui/color-mode.tsx";

// Design tokens
export { chatTokens, getChatTokensCSS } from "./components/chat/chat-tokens.ts";
export {
  ChatStyleProvider,
  type ChatStyleProviderProps,
} from "./components/chat/chat-style-provider.tsx";

// ---------------------------------------------------------------------------
// Chat — hooks (veryfront/chat)
// ---------------------------------------------------------------------------
export { useChat } from "#veryfront/agent/react/use-chat/index.ts";
export type {
  BranchInfo,
  ChatDynamicToolPart,
  ChatMessage,
  ChatMessagePart,
  ChatReasoningPart,
  ChatStepPart,
  ChatTextPart,
  ChatToolPart,
  ChatToolResultPart,
  ChatToolState,
  InferenceMode,
  OnToolCallArg,
  ToolOutput,
  UseChatOptions,
  UseChatResult,
} from "#veryfront/agent/react/use-chat/index.ts";
export type { ChatFinishReason, ChatStreamEvent } from "#veryfront/agent/react/use-chat/index.ts";

export { useAgent } from "#veryfront/agent/react/use-agent.ts";
export type { UseAgentOptions, UseAgentResult } from "#veryfront/agent/react/use-agent.ts";

export {
  getAgentPromptSuggestions,
  normalizeAgentMetadata,
  normalizeAgentMetadataResponse,
  useAgentMetadata,
} from "#veryfront/agent/react/use-agent-metadata.ts";
export type {
  AgentMetadata,
  AgentMetadataPromptSuggestion,
  AgentMetadataSuggestion,
  AgentMetadataSuggestions,
  AgentMetadataTaskSuggestion,
  UseAgentMetadataResult,
} from "#veryfront/agent/react/use-agent-metadata.ts";

export { normalizeAgentsListResponse, useAgents } from "#veryfront/agent/react/use-agents.ts";
export type { UseAgentsOptions, UseAgentsResult } from "#veryfront/agent/react/use-agents.ts";

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
