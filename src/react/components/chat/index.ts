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
} from "../ui/color-mode.tsx";

// ---------------------------------------------------------------------------
// Design Tokens
// ---------------------------------------------------------------------------
export { chatTokens, getChatTokensCSS } from "./chat-tokens.ts";
export { ChatStyleProvider, type ChatStyleProviderProps } from "./chat-style-provider.tsx";

// ---------------------------------------------------------------------------
// Chat — Core preset + compound
// ---------------------------------------------------------------------------
export { Chat, type ChatAgentInfo, type ChatProps } from "./chat.tsx";

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
  type ChatInputExportProps,
  type ChatInputProps,
  ChatMessageList,
  type ChatMessageListContentProps,
  type ChatMessageListProps,
  ChatRoot,
  type ChatRootProps,
  ErrorBanner,
  type ErrorBannerProps,
  Message,
  type MessageProps,
  type MessageRootProps,
  type MessageTokensProps,
  ModelAvatar,
  type ModelAvatarProps,
  type TokenRowProps,
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
  type MessagePartsData,
  useChatContext,
  useChatContextOptional,
  useComposerContext,
  useComposerContextOptional,
  useMessageContext,
  useMessageContextOptional,
  useMessageParts,
} from "./chat.tsx";

// ---------------------------------------------------------------------------
// Chat - Conversation session
// ---------------------------------------------------------------------------
export {
  useConversationChat,
  type UseConversationChatOptions,
  type UseConversationChatResult,
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
  RichCodeBlock,
  Shimmer,
  SkillBadge,
  Sources,
  StepIndicator,
  Suggestion,
  Suggestions,
  TabSwitcher,
  ToolStatusBadge,
  useUpload,
} from "./chat.tsx";
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
