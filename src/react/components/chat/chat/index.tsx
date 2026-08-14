/**
 * Chat UI Component System
 *
 * Provides a full-featured chat interface via the `Chat` preset component,
 * along with composable building blocks for custom layouts.
 *
 * @example Quick start (preset)
 * ```tsx
 * import { Chat, useChat } from "veryfront/chat";
 *
 * export default function Page() {
 *   const chat = useChat();
 *   return <Chat chat={chat} />;
 * }
 * ```
 *
 * @example App mode (black box — no wiring)
 * ```tsx
 * <Chat agentId="support" api="/api/ag-ui" />
 * ```
 *
 * @example Custom layout (composition)
 * ```tsx
 * <Chat.Root messages={messages} input={input}>
 *   <Chat.If condition={(ctx) => ctx.isEmpty}><Chat.Empty title="Ask anything" /></Chat.If>
 *   <Chat.MessageList messages={messages} />
 *   <Chat.Input input={input} onChange={onChange} />
 * </Chat.Root>
 * ```
 *
 * @example Per-message control (compound)
 * ```tsx
 * import { Message } from "veryfront/chat";
 *
 * <Message.Root message={msg}>
 *   <Message.Avatar />
 *   <Message.Content />
 *   <Message.Actions />
 * </Message.Root>
 * ```
 *
 * @module react/components/chat
 */

// Re-exports — sub-components

export { FadeIn, Loader, Shimmer } from "./components/animations.tsx";
export {
  Reasoning,
  type ReasoningContextValue,
  type ReasoningProps,
  type ReasoningTriggerProps,
  useReasoning,
} from "./components/reasoning.tsx";
export {
  ConversationEmptyState,
  type ConversationEmptyStateProps,
  ConversationScrollButton,
  type ConversationScrollButtonProps,
  Suggestion,
  type SuggestionProps,
  Suggestions,
  type SuggestionsProps,
} from "./components/empty-state.tsx";
export {
  MessageActionBar,
  type MessageActionBarActionProps,
  type MessageActionBarProps,
} from "./components/message-actions.tsx";
export { MessageEditForm, type MessageEditFormProps } from "./components/message-edit-form.tsx";
export {
  BranchPicker,
  type BranchPickerActionProps,
  type BranchPickerCountProps,
  type BranchPickerProps,
} from "./components/branch-picker.tsx";
export { DropZoneOverlay, type DropZoneOverlayProps } from "./components/drop-zone.tsx";
export {
  ChatMessagesSkeleton,
  type ChatMessagesSkeletonProps,
} from "./components/chat-messages-skeleton.tsx";
export { SkillBadge, type SkillBadgeProps } from "./components/skill-badge.tsx";
export {
  ToolCall,
  type ToolCallContextValue,
  type ToolCallProps,
  type ToolCallTriggerProps,
  ToolStatusBadge,
  useToolCall,
} from "./components/tool-ui.tsx";
export { InferenceBadge, type InferenceBadgeProps } from "./components/inference-badge.tsx";
export {
  type Source,
  SourcePill,
  type SourcePillProps,
  Sources,
  type SourcesContextValue,
  type SourcesListProps,
  type SourcesProps,
  useSources,
} from "./components/sources.tsx";
export {
  InlineCitation,
  type InlineCitationCardProps,
  type InlineCitationProps,
  type InlineCitationTriggerProps,
} from "./components/inline-citation.tsx";
export {
  type FeedbackValue,
  MessageFeedback,
  type MessageFeedbackActionProps,
  type MessageFeedbackProps,
} from "./components/message-feedback.tsx";
export {
  type AttachmentInfo,
  AttachmentPill,
  type AttachmentPillContextValue,
  type AttachmentPillProps,
  useAttachmentPill,
} from "./components/attachment-pill.tsx";
export { type CodeBlockProps, RichCodeBlock } from "./components/code-block.tsx";
export {
  StepIndicator,
  type StepIndicatorContextValue,
  type StepIndicatorProps,
  useStepIndicator,
} from "./components/step-indicator.tsx";
// The sub-components (`ChatSidebar.Root` / `.Item` / …) hang off the compound
// object, so only the preset needs to be a runtime export. The rest are
// type-only — they annotate props without widening the public runtime surface.
export {
  ChatSidebar,
  type ChatSidebarComponent,
  type ChatSidebarEmptyProps,
  type ChatSidebarGroupProps,
  type ChatSidebarItemActionProps,
  type ChatSidebarItemComponent,
  type ChatSidebarItemContextValue,
  type ChatSidebarItemMenuProps,
  type ChatSidebarItemProps,
  type ChatSidebarItemRenderOptions,
  type ChatSidebarListProps,
  type ChatSidebarNewButtonProps,
  type ChatSidebarProps,
  type ChatSidebarRootProps,
  useChatSidebarItem,
} from "./components/sidebar.tsx";
export { type ChatTab, TabSwitcher, type TabSwitcherProps } from "./components/tab-switcher.tsx";
export {
  type QuickAction,
  QuickActions,
  type QuickActionsProps,
} from "./components/quick-actions.tsx";
export {
  AttachmentsPanel,
  type AttachmentsPanelActionProps,
  type AttachmentsPanelContextValue,
  type AttachmentsPanelEmptyProps,
  type AttachmentsPanelHeaderProps,
  type AttachmentsPanelItemProps,
  type AttachmentsPanelListProps,
  type AttachmentsPanelLoadingProps,
  type AttachmentsPanelProps,
  type UploadedFile,
  useAttachmentsPanel,
} from "./components/attachments-panel.tsx";

export { useConversations } from "./hooks/use-conversations.ts";
export type * from "./hooks/use-conversations.ts";
export {
  useConversation,
  type UseConversationOptions,
  type UseConversationPersistenceState,
  type UseConversationResult,
} from "./hooks/use-conversation.ts";
export {
  ConversationsContextProvider,
  type ConversationsContextValue,
  ConversationsProvider,
  type ConversationsProviderProps,
  useConversationsContext,
  useConversationsContextOptional,
} from "./contexts/conversations-context.tsx";

export {
  type Conversation,
  type ConversationStore,
  ConversationStoreError,
  type ConversationStoreOperation,
  type ConversationSummary,
} from "./persistence/conversation-store.ts";
export { CONVERSATION_STORAGE_LIMITS } from "./persistence/conversation-codec.ts";
export type { ConversationStorageLimits } from "./persistence/conversation-codec.ts";
export {
  localConversationStore,
  type StorageLike,
} from "./persistence/local-conversation-store.ts";
export { memoryConversationStore } from "./persistence/memory-conversation-store.ts";
export { useUpload, type UseUploadOptions, type UseUploadResult } from "./hooks/use-upload.ts";
export {
  useConversationChat,
  type UseConversationChatOptions,
  type UseConversationChatResult,
} from "./hooks/use-conversation-chat.ts";
export {
  useAttachments,
  type UseAttachmentsOptions,
  type UseAttachmentsRequestState,
  type UseAttachmentsResult,
  type UseAttachmentsStorageState,
} from "./hooks/use-uploads-registry.ts";
export {
  extractSourcesFromParts,
  getTextContent,
  groupPartsInOrder,
  isReasoningPart,
  isSkillToolPart,
  isToolPart,
  type PartGroup,
} from "./utils/message-parts.ts";
export { downloadMarkdown, exportAsMarkdown } from "./utils/export.ts";

export {
  AgentAvatar,
  type AgentAvatarProps,
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
} from "./composition/api.tsx";
export type * from "./composition/chat-composer.types.ts";

export {
  ChatContextProvider,
  type ChatContextValue,
  ChatInputContextProvider,
  type ChatInputContextValue,
  ComposerContextProvider,
  type ComposerContextValue,
  MessageContextProvider,
  type MessageContextValue,
  type MessagePartsData,
  useChatContext,
  useChatContextOptional,
  useChatInputContext,
  useChatInputContextOptional,
  useComposerContext,
  useComposerContextOptional,
  useMessageBranches,
  type UseMessageBranchesResult,
  useMessageContext,
  useMessageContextOptional,
  useMessageParts,
} from "./contexts/index.ts";

export type { ChatAgentInfo, ChatProps } from "./chat-props.ts";
export { Chat } from "./chat-preset.tsx";
