/**
 * Chat re-export aggregator — single import path for all chat components.
 *
 * @module ai/react/components/ai/chat
 */

// ---------------------------------------------------------------------------
// Core preset + compound
// ---------------------------------------------------------------------------
export { Chat, ChatComponents, type ChatProps } from "./chat/index.tsx";

// ---------------------------------------------------------------------------
// Composition building blocks
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
} from "./chat/index.tsx";

// ---------------------------------------------------------------------------
// Contexts
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
} from "./chat/index.tsx";

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------
export {
  type AttachmentInfo,
  AttachmentPill,
  type AttachmentPillProps,
  BranchPicker,
  type BranchPickerProps,
  ChatSidebar,
  type ChatSidebarProps,
  type ChatTab,
  type CodeBlockProps,
  ConversationEmptyState,
  type ConversationEmptyStateProps,
  ConversationScrollButton,
  type ConversationScrollButtonProps,
  downloadMarkdown,
  DropZoneOverlay,
  type DropZoneOverlayProps,
  exportAsMarkdown,
  extractSourcesFromParts,
  FadeIn,
  type FeedbackValue,
  getTextContent,
  groupPartsInOrder,
  InferenceBadge,
  type InferenceBadgeProps,
  InlineCitation,
  type InlineCitationProps,
  isReasoningPart,
  isToolPart,
  Loader,
  MessageActions,
  type MessageActionsProps,
  MessageEditForm,
  type MessageEditFormProps,
  MessageFeedback,
  type MessageFeedbackProps,
  type PartGroup,
  type QuickAction,
  QuickActions,
  type QuickActionsProps,
  ReasoningCard,
  RichCodeBlock,
  Shimmer,
  type Source,
  Sources,
  type SourcesProps,
  StepIndicator,
  type StepIndicatorProps,
  Suggestion,
  type SuggestionProps,
  Suggestions,
  type SuggestionsProps,
  TabSwitcher,
  type TabSwitcherProps,
  type Thread,
  ToolCallCard,
  ToolStatusBadge,
  UpgradeCTA,
  type UpgradeCTAProps,
  type UploadedFile,
  UploadsPanel,
  type UploadsPanelProps,
  useThreads,
  type UseThreadsOptions,
  type UseThreadsResult,
} from "./chat/index.tsx";

// ---------------------------------------------------------------------------
// Adjacent components
// ---------------------------------------------------------------------------
export { type ModelOption, ModelSelector, type ModelSelectorProps } from "./model-selector.tsx";
export { ChatWithSidebar, type ChatWithSidebarProps } from "./chat-with-sidebar.tsx";
