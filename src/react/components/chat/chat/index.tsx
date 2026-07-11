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
 *   <Chat.Empty title="Ask anything" />
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

import * as React from "react";

import type { ChatComponent } from "./chat-component.ts";
import type { ChatProps } from "./chat-props.ts";
import { ControlledChat } from "./controlled-chat.tsx";
import { ConversationBoundChat } from "./app-mode-chat.tsx";

// Composition imports (used in the Chat preset)
import { ChatRoot } from "./composition/chat-root.tsx";
import { ChatInput } from "./composition/chat-composer.tsx";
import { ChatMessageList } from "./composition/chat-message-list.tsx";
import { ChatEmpty } from "./composition/chat-empty.tsx";
import { ChatIf } from "./composition/chat-if.tsx";
import { ErrorBanner } from "./composition/error-banner.tsx";
import { Message } from "./composition/message.tsx";
import { ChatMessagesSkeleton } from "./components/chat-messages-skeleton.tsx";

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

export {
  type ConversationPatch,
  useConversations,
  type UseConversationsOptions,
  type UseConversationsResult,
} from "./hooks/use-conversations.ts";
export {
  useConversation,
  type UseConversationOptions,
  type UseConversationResult,
} from "./hooks/use-conversation.ts";
export {
  ConversationsContextProvider,
  ConversationsProvider,
  type ConversationsProviderProps,
  useConversationsContext,
  useConversationsContextOptional,
} from "./contexts/conversations-context.tsx";

export {
  type Conversation,
  type ConversationStore,
  type ConversationSummary,
} from "./persistence/conversation-store.ts";
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
  useUploadsRegistry,
  type UseUploadsRegistryOptions,
  type UseUploadsRegistryResult,
} from "./hooks/use-uploads-registry.ts";
export {
  useStickToBottom,
  type UseStickToBottomOptions,
  type UseStickToBottomResult,
} from "./hooks/use-stick-to-bottom.ts";

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
} from "./composition/api.tsx";

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
} from "./contexts/index.ts";

// ChatProps: preset interface, re-exported here to preserve the public surface.

export type { ChatAgentInfo, ChatProps } from "./chat-props.ts";

// Chat — Preset component. `ControlledChat` (controlled mode) and
// `ConversationBoundChat`/`UncontrolledChat` (app mode) live in sibling files;
// this module wires them into the `Chat` compound.

/**
 * Chat — batteries-included chat surface.
 *
 * - **App mode (uncontrolled):** omit `chat` and pass `agentId` + `api`;
 *   `<Chat>` wires `useChat` + `useAgentMetadata` internally. Inside a
 *   `ConversationsProvider` it also binds to the active conversation.
 * - **Controlled mode:** pass `chat={useChat()}`.
 */
function ChatBase(props: ChatProps): React.ReactElement {
  return props.chat !== undefined
    ? <ControlledChat {...props} chat={props.chat} />
    : <ConversationBoundChat ref={props.ref} {...props} />;
}
ChatBase.displayName = "Chat";

// ---------------------------------------------------------------------------
// Chat — Compound API via Object.assign. The default export IS the compound, so
// `Chat.Root` / `Chat.Empty` / `Chat.Skeleton` / … are all typed off the same
// import.
// ---------------------------------------------------------------------------

/** Render chat components. */
export const Chat: ChatComponent = Object.assign(ChatBase, {
  Root: ChatRoot,
  MessageList: ChatMessageList,
  Input: ChatInput,
  Empty: ChatEmpty,
  Skeleton: ChatMessagesSkeleton,
  If: ChatIf,
  Message: Message,
  ErrorBanner: ErrorBanner,
});
