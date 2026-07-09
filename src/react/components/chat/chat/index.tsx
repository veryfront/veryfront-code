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

// Extracted implementations (re-exported below to preserve the public surface)
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

// ---------------------------------------------------------------------------
// Re-exports — sub-components
// ---------------------------------------------------------------------------

export { FadeIn, Loader, Shimmer } from "./components/animations.tsx";
export {
  Reasoning,
  ReasoningCard,
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
export { MessageActionBar, type MessageActionBarProps } from "./components/message-actions.tsx";
export { MessageEditForm, type MessageEditFormProps } from "./components/message-edit-form.tsx";
export { BranchPicker, type BranchPickerProps } from "./components/branch-picker.tsx";
export { DropZoneOverlay, type DropZoneOverlayProps } from "./components/drop-zone.tsx";
export {
  ChatMessagesSkeleton,
  type ChatMessagesSkeletonProps,
} from "./components/chat-messages-skeleton.tsx";
export { SkillBadge, type SkillBadgeProps } from "./components/skill-badge.tsx";
export {
  ToolCall,
  ToolCallCard,
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
export { InlineCitation, type InlineCitationProps } from "./components/inline-citation.tsx";
export {
  type FeedbackValue,
  MessageFeedback,
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
  type ChatSidebarIcons,
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

// Re-exports — hooks
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

// Re-exports — conversation persistence adapters
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

// Re-exports — utils
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

// Re-exports — composition
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
} from "./composition/api.tsx";

// Re-exports — contexts
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
} from "./contexts/index.ts";

// ---------------------------------------------------------------------------
// ChatProps — Preset interface (moved to ./chat-props.ts; re-exported here to
// preserve the public surface).
// ---------------------------------------------------------------------------

export type { ChatAgentInfo, ChatProps } from "./chat-props.ts";

// ---------------------------------------------------------------------------
// Chat — Preset component. `ControlledChat` (controlled mode) and
// `ConversationBoundChat`/`UncontrolledChat` (app mode) live in sibling files;
// this module wires them into the `Chat` compound.
// ---------------------------------------------------------------------------

/**
 * Normalize the consolidated `chat={useChat()}` / `agent={…}` objects onto the
 * flat props `ControlledChat` consumes. The object API wins; the legacy flat
 * props remain as a one-release fallback. Agent-driven content (`models`,
 * `suggestions`) folds in too.
 */
function resolveControlledProps(props: ChatProps): ChatProps {
  const { chat, agent } = props;
  const merged: ChatProps = {
    ...props,
    models: agent?.models ?? props.models,
    suggestions: props.suggestions ?? agent?.suggestions,
  };
  if (chat) {
    merged.messages = chat.messages;
    merged.input = chat.input;
    merged.onChange = chat.onChange;
    merged.onSubmit = props.onSubmit ?? chat.onSubmit;
    merged.sendMessage = chat.sendMessage;
    merged.stop = chat.stop;
    merged.reload = () => void chat.reload();
    merged.setInput = chat.setInput;
    merged.isLoading = chat.isLoading;
    merged.error = chat.error;
    merged.model = chat.model;
    merged.activeModel = chat.activeModel;
    merged.onModelChange = chat.onModelChange;
    merged.inferenceMode = chat.inferenceMode;
    merged.editMessage = chat.editMessage;
    merged.getBranches = chat.getBranches;
    merged.switchBranch = chat.switchBranch;
  }
  return merged;
}

/**
 * Chat — batteries-included chat surface.
 *
 * - **App mode (uncontrolled):** omit `chat`/`messages` and pass `agentId` +
 *   `api`; `<Chat>` wires `useChat` + `useAgentMetadata` internally. Inside a
 *   `ConversationsProvider` it also binds to the active conversation.
 * - **Controlled mode:** pass `chat={useChat()}` (preferred) or the legacy
 *   flat `messages` + `input` props to drive it yourself.
 */
function ChatBase(props: ChatProps): React.ReactElement {
  // Controlled when the caller supplies a `chat` session (or the legacy flat
  // message/input state); otherwise the component self-drives (app mode).
  const isControlled = props.chat !== undefined ||
    (props.messages !== undefined && props.input !== undefined);
  return isControlled
    ? <ControlledChat ref={props.ref} {...resolveControlledProps(props)} />
    : <ConversationBoundChat ref={props.ref} {...props} />;
}
ChatBase.displayName = "Chat";

// ---------------------------------------------------------------------------
// Chat — Compound API via Object.assign. The default export IS the compound, so
// `Chat.Root` / `Chat.Empty` / `Chat.Skeleton` / … are all typed off the same
// import (`ChatComponents` kept as a back-compat alias).
// ---------------------------------------------------------------------------

export type ChatComponentsType = typeof ChatBase & {
  Root: typeof ChatRoot;
  MessageList: typeof ChatMessageList;
  Input: typeof ChatInput;
  /** @deprecated Use `Chat.Input`. */
  Composer: typeof ChatInput;
  Empty: typeof ChatEmpty;
  Skeleton: typeof ChatMessagesSkeleton;
  If: typeof ChatIf;
  Message: typeof Message;
  ErrorBanner: typeof ErrorBanner;
};

/** Render chat components. */
export const Chat: ChatComponentsType = Object.assign(ChatBase, {
  Root: ChatRoot,
  MessageList: ChatMessageList,
  Input: ChatInput,
  Composer: ChatInput,
  Empty: ChatEmpty,
  Skeleton: ChatMessagesSkeleton,
  If: ChatIf,
  Message: Message,
  ErrorBanner: ErrorBanner,
});

/** @deprecated Back-compat alias — `Chat` is now the compound itself. */
export const ChatComponents: ChatComponentsType = Chat;
