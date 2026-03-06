/**
 * Chat UI components and streaming hooks.
 *
 * @module chat
 *
 * @example Basic chat (preset)
 * ```tsx
 * import { Chat, useChat } from "veryfront/chat";
 *
 * export default function Page() {
 *   const chat = useChat({ api: "/api/chat" });
 *   return (
 *     <Chat
 *       messages={chat.messages}
 *       input={chat.input}
 *       onChange={chat.handleInputChange}
 *       onSubmit={chat.handleSubmit}
 *     />
 *   );
 * }
 * ```
 *
 * @example Custom layout (composition)
 * ```tsx
 * import { Chat, useChat } from "veryfront/chat";
 *
 * export default function Page() {
 *   const chat = useChat({ api: "/api/chat" });
 *   return (
 *     <Chat.Root messages={chat.messages} input={chat.input}>
 *       <Chat.Empty title="Ask me anything" />
 *       <Chat.MessageList messages={chat.messages} />
 *       <Chat.Composer input={chat.input} onChange={chat.handleInputChange} onSubmit={chat.handleSubmit} />
 *     </Chat.Root>
 *   );
 * }
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
 */

// veryfront/chat — Chat UI components + hooks
//
// Merges components/ai (UI) and agent/react (hooks) into a single
// product-oriented import path.

// ---------------------------------------------------------------------------
// Core preset + compound
// ---------------------------------------------------------------------------

export { Chat, ChatComponents } from "#veryfront/react/components/ai/chat.tsx";
export type { ChatProps } from "#veryfront/react/components/ai/chat.tsx";

// ---------------------------------------------------------------------------
// Composition building blocks
// ---------------------------------------------------------------------------

export {
  ChatComposer,
  ChatEmpty,
  ChatIf,
  ChatMessageList,
  ChatRoot,
  ErrorBanner,
  Message,
  ModelAvatar,
} from "#veryfront/react/components/ai/chat.tsx";
export type {
  ChatComposerProps,
  ChatEmptyProps,
  ChatIfProps,
  ChatMessageListProps,
  ChatRootProps,
  ErrorBannerProps,
  MessageRootProps,
  ModelAvatarProps,
} from "#veryfront/react/components/ai/chat.tsx";

// ---------------------------------------------------------------------------
// Contexts
// ---------------------------------------------------------------------------

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
} from "#veryfront/react/components/ai/chat.tsx";
export type {
  ChatContextValue,
  ComposerContextValue,
  MessageContextValue,
  ThreadListContextValue,
} from "#veryfront/react/components/ai/chat.tsx";

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

export {
  AttachmentPill,
  BranchPicker,
  ChatSidebar,
  ChatWithSidebar,
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
  UploadsPanel,
  useThreads,
} from "#veryfront/react/components/ai/chat.tsx";
export type {
  AttachmentInfo,
  AttachmentPillProps,
  BranchPickerProps,
  ChatSidebarProps,
  ChatTab,
  ChatWithSidebarAttachmentConfig,
  ChatWithSidebarChatController,
  ChatWithSidebarFeatureConfig,
  ChatWithSidebarGroupedProps,
  ChatWithSidebarMessageConfig,
  ChatWithSidebarModelConfig,
  ChatWithSidebarProps,
  ChatWithSidebarQuickActionsConfig,
  ChatWithSidebarSidebarConfig,
  ChatWithSidebarTabsConfig,
  ChatWithSidebarVoiceConfig,
  CodeBlockProps,
  ConversationEmptyStateProps,
  ConversationScrollButtonProps,
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
  UploadedFile,
  UploadsPanelProps,
  UseThreadsOptions,
  UseThreadsResult,
} from "#veryfront/react/components/ai/chat.tsx";

// Message (standalone bubble, not the chat compound)
export {
  Message as StandaloneMessage,
  StreamingMessage,
} from "#veryfront/react/components/ai/message.tsx";
export type {
  MessageProps,
  StreamingMessageProps,
} from "#veryfront/react/components/ai/message.tsx";

export { AgentCard } from "#veryfront/react/components/ai/agent-card.tsx";
export type { AgentCardProps } from "#veryfront/react/components/ai/agent-card.tsx";

export {
  AIErrorBoundary,
  useAIErrorHandler,
} from "#veryfront/react/components/ai/error-boundary.tsx";
export type { AIErrorBoundaryProps } from "#veryfront/react/components/ai/error-boundary.tsx";

// Types only from theme
export type { AgentTheme, ChatTheme } from "#veryfront/react/components/ai/theme.ts";

// ---------------------------------------------------------------------------
// Hooks (from agent/react)
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
