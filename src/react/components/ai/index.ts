/**
 * Components - AI
 *
 * @module react/components/ai
 */

// ---------------------------------------------------------------------------
// Theme & Utilities
// ---------------------------------------------------------------------------
export {
  type AgentTheme,
  chatButtonVariants,
  chatContainerVariants,
  type ChatTheme,
  cn,
  cva,
  defaultAgentTheme,
  defaultChatTheme,
  mergeThemes,
  messageVariants,
  type VariantProps,
} from "./theme.ts";

// ---------------------------------------------------------------------------
// Color Mode
// ---------------------------------------------------------------------------
export {
  ColorModeProvider,
  type ColorModeProviderProps,
  ColorModeScript,
  ColorModeToggle,
  useColorMode,
} from "./color-mode.tsx";

// ---------------------------------------------------------------------------
// Design Tokens
// ---------------------------------------------------------------------------
export { chatTokens, getChatTokensCSS } from "./chat-tokens.ts";
export { ChatStyleProvider, type ChatStyleProviderProps } from "./chat-style-provider.tsx";

// ---------------------------------------------------------------------------
// Chat — Core preset + compound
// ---------------------------------------------------------------------------
export { Chat, ChatComponents, type ChatProps } from "./chat.tsx";

// ---------------------------------------------------------------------------
// Chat — Composition building blocks
// ---------------------------------------------------------------------------
export {
  ChatComposer,
  type ChatComposerProps,
  ChatEmpty,
  type ChatEmptyProps,
  ChatIf,
  type ChatIfProps,
  ChatMessageList,
  type ChatMessageListProps,
  ChatRoot,
  type ChatRootProps,
  ErrorBanner,
  type ErrorBannerProps,
  Message,
  type MessageRootProps,
  ModelAvatar,
  type ModelAvatarProps,
} from "./chat.tsx";

// ---------------------------------------------------------------------------
// Chat — Contexts
// ---------------------------------------------------------------------------
export {
  ChatContextProvider,
  type ChatContextValue,
  ComposerContextProvider,
  type ComposerContextValue,
  MessageContextProvider,
  type MessageContextValue,
  ThreadListContextProvider,
  type ThreadListContextValue,
  useChatContext,
  useChatContextOptional,
  useComposerContext,
  useComposerContextOptional,
  useMessageContext,
  useMessageContextOptional,
  useThreadListContext,
  useThreadListContextOptional,
} from "./chat.tsx";

// ---------------------------------------------------------------------------
// Chat — Sub-components
// ---------------------------------------------------------------------------
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
} from "./chat.tsx";
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
} from "./chat.tsx";

// ---------------------------------------------------------------------------
// Agent Card
// ---------------------------------------------------------------------------
export { AgentCard } from "./agent-card.tsx";
export type { AgentCardProps } from "./agent-card.tsx";

// ---------------------------------------------------------------------------
// Message (standalone bubble component — not the chat compound)
// ---------------------------------------------------------------------------
export { Message as StandaloneMessage, StreamingMessage } from "./message.tsx";
export type { MessageProps, StreamingMessageProps } from "./message.tsx";

// ---------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------
export { Markdown } from "./markdown.tsx";
export type { CodeBlockProps, MarkdownProps } from "./markdown.tsx";

// ---------------------------------------------------------------------------
// Error Boundary
// ---------------------------------------------------------------------------
export { AIErrorBoundary, useAIErrorHandler } from "./error-boundary.tsx";
export type { AIErrorBoundaryProps } from "./error-boundary.tsx";
