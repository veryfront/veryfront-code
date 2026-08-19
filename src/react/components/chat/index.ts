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
  type ChatInputActionProps,
  ChatInputAttach,
  type ChatInputAttachProps,
  ChatInputExport,
  type ChatInputExportProps,
  ChatInputField,
  type ChatInputFieldProps,
  ChatInputModel,
  type ChatInputModelProps,
  type ChatInputProps,
  ChatInputRoot,
  type ChatInputRootProps,
  ChatInputSend,
  type ChatInputSendProps,
  type ChatInputSlottedActionProps,
  type ChatInputSlottedSubmitProps,
  ChatInputStop,
  type ChatInputStopProps,
  ChatInputSubmit,
  type ChatInputSubmitProps,
  ChatInputToolbar,
  type ChatInputToolbarProps,
  ChatInputVoice,
  type ChatInputVoiceProps,
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
  ChatInputContextProvider,
  type ChatInputContextValue,
  MessageContextProvider,
  type MessageContextValue,
  type MessagePartsData,
  useChatContext,
  useChatContextOptional,
  useChatInputContext,
  useChatInputContextOptional,
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
// Chat - Conversation persistence
// ---------------------------------------------------------------------------
export {
  type ActiveConversationLoadFailure,
  type Conversation,
  CONVERSATION_STORAGE_LIMITS,
  type ConversationPatch,
  ConversationsContextProvider,
  type ConversationsContextValue,
  ConversationsProvider,
  type ConversationsProviderProps,
  type ConversationStorageLimits,
  type ConversationStore,
  ConversationStoreError,
  type ConversationStoreOperation,
  type ConversationSummary,
  localConversationStore,
  memoryConversationStore,
  type StorageLike,
  useConversation,
  type UseConversationOptions,
  type UseConversationPersistenceState,
  type UseConversationResult,
  useConversations,
  type UseConversationsActiveLoadState,
  useConversationsContext,
  useConversationsContextOptional,
  type UseConversationsOptions,
  type UseConversationsPersistenceState,
  type UseConversationsResult,
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
  Reasoning,
  RichCodeBlock,
  Shimmer,
  SkillBadge,
  Sources,
  StepIndicator,
  Suggestion,
  Suggestions,
  TabSwitcher,
  ToolCall,
  ToolStatusBadge,
  useReasoning,
  useToolCall,
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
  ReasoningContextValue,
  ReasoningProps,
  ReasoningTriggerProps,
  SkillBadgeProps,
  Source,
  SourcesProps,
  StepIndicatorProps,
  SuggestionProps,
  SuggestionsProps,
  TabSwitcherProps,
  ToolCallContextValue,
  ToolCallProps,
  ToolCallTriggerProps,
  UploadedFile,
  UseUploadOptions,
  UseUploadResult,
} from "./chat.tsx";

// Compound component and headless-hook parity with the canonical chat barrel.
export {
  AgentAvatar,
  type AgentAvatarProps,
  type AttachmentPillContextValue,
  type AttachmentsPanelActionProps,
  type AttachmentsPanelContextValue,
  type AttachmentsPanelEmptyProps,
  type AttachmentsPanelHeaderProps,
  type AttachmentsPanelItemProps,
  type AttachmentsPanelListProps,
  type AttachmentsPanelLoadingProps,
  ChatMessagesSkeleton,
  type ChatMessagesSkeletonProps,
  mergeProps,
  type ModelSelectorContentProps,
  type ModelSelectorContextValue,
  type ModelSelectorItemProps,
  type ModelSelectorTriggerProps,
  SourcePill,
  type SourcePillProps,
  type SourcesContextValue,
  type SourcesListProps,
  type StepIndicatorContextValue,
  useAttachmentPill,
  useAttachments,
  type UseAttachmentsOptions,
  useAttachmentsPanel,
  type UseAttachmentsRequestState,
  type UseAttachmentsResult,
  type UseAttachmentsStorageState,
  useChatInput,
  type UseChatInputResult,
  useChatScroll,
  type UseChatScrollOptions,
  type UseChatScrollResult,
  useMessageBranches,
  type UseMessageBranchesResult,
  useModelSelector,
  useSources,
  useStepIndicator,
} from "./chat.tsx";

// ---------------------------------------------------------------------------
// Agent Card
// ---------------------------------------------------------------------------
export { AgentCard } from "./agent-card.tsx";
export type { AgentCardProps } from "./agent-card.tsx";

// ---------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------
export {
  Markdown,
  MarkdownRendererCapabilityError,
  MarkdownRendererProvider,
} from "./markdown.tsx";
export type {
  CodeBlockProps,
  Components,
  MarkdownComponents,
  MarkdownElementRendererProps,
  MarkdownProps,
  MarkdownRenderer,
  MarkdownRendererProps,
  MarkdownRendererProviderProps,
} from "./markdown.tsx";

// ---------------------------------------------------------------------------
// Error Boundary
// ---------------------------------------------------------------------------
export { ChatErrorBoundary, useChatErrorHandler } from "./error-boundary.tsx";
export type { ChatErrorBoundaryProps } from "./error-boundary.tsx";
