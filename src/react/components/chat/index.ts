/**
 * Components - Chat
 *
 * @module react/components/chat
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
  defaultAgentTheme,
  defaultChatTheme,
  mergeThemes,
  messageVariants,
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
  ChatEmpty,
  type ChatEmptyProps,
  ChatEmptyState,
  type ChatEmptyStateAvatarProps,
  type ChatEmptyStateHeadingProps,
  type ChatEmptyStateRootProps,
  type ChatEmptyStateSuggestionProps,
  type ChatEmptyStateSuggestionsProps,
  ChatIf,
  type ChatIfProps,
  ChatInput,
  type ChatInputProps,
  ChatMessageList,
  type ChatMessageListProps,
  ChatRoot,
  type ChatRootProps,
  ErrorBanner,
  type ErrorBannerProps,
  Message,
  type MessageProps,
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
  useChatContext,
  useChatContextOptional,
  useComposerContext,
  useComposerContextOptional,
  useMessageContext,
  useMessageContextOptional,
} from "./chat.tsx";

// ---------------------------------------------------------------------------
// Chat — Sub-components
// ---------------------------------------------------------------------------
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
  isSkillToolPart,
  isToolPart,
  Loader,
  MessageActionBar,
  MessageEditForm,
  MessageFeedback,
  ModelSelector,
  QuickActions,
  ReasoningCard,
  RichCodeBlock,
  Shimmer,
  SkillBadge,
  Sources,
  StepIndicator,
  Suggestion,
  Suggestions,
  TabSwitcher,
  ToolCallCard,
  ToolStatusBadge,
  useUpload,
} from "./chat.tsx";
export type {
  AttachmentInfo,
  AttachmentPillProps,
  AttachmentsPanelProps,
  BranchPickerProps,
  ChatSidebarComponent,
  ChatSidebarEmptyProps,
  ChatSidebarGroupProps,
  ChatSidebarIcons,
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
  InlineCitationProps,
  MessageActionBarProps,
  MessageEditFormProps,
  MessageFeedbackProps,
  ModelOption,
  ModelSelectorProps,
  PartGroup,
  QuickAction,
  QuickActionsProps,
  SkillBadgeProps,
  Source,
  SourcesProps,
  StepIndicatorProps,
  SuggestionProps,
  SuggestionsProps,
  TabSwitcherProps,
  UploadedFile,
  UseUploadOptions,
  UseUploadResult,
} from "./chat.tsx";

// ---------------------------------------------------------------------------
// Agent Card
// ---------------------------------------------------------------------------
export { AgentCard } from "./agent-card.tsx";
export type { AgentCardProps } from "./agent-card.tsx";

// ---------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------
export { Markdown } from "./markdown.tsx";
export type { CodeBlockProps, MarkdownProps } from "./markdown.tsx";

// ---------------------------------------------------------------------------
// Error Boundary
// ---------------------------------------------------------------------------
export { ChatErrorBoundary, useChatErrorHandler } from "./error-boundary.tsx";
export type { ChatErrorBoundaryProps } from "./error-boundary.tsx";
