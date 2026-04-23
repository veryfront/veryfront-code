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

export { Chat, ChatComponents, type ChatProps } from "#veryfront/react/components/chat/chat.tsx";

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
} from "#veryfront/react/components/chat/chat.tsx";

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
} from "#veryfront/react/components/chat/chat.tsx";

export {
  type AttachmentInfo,
  AttachmentPill,
  type AttachmentPillProps,
  BranchPicker,
  type BranchPickerProps,
  ChatSidebar,
  type ChatSidebarProps,
  type ChatTab,
  ChatWithSidebar,
  type ChatWithSidebarAttachmentConfig,
  type ChatWithSidebarChatController,
  type ChatWithSidebarFeatureConfig,
  type ChatWithSidebarGroupedProps,
  type ChatWithSidebarMessageConfig,
  type ChatWithSidebarModelConfig,
  type ChatWithSidebarProps,
  type ChatWithSidebarQuickActionsConfig,
  type ChatWithSidebarSidebarConfig,
  type ChatWithSidebarTabsConfig,
  type ChatWithSidebarVoiceConfig,
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
  isSkillToolPart,
  isToolPart,
  Loader,
  MessageActions,
  type MessageActionsProps,
  MessageEditForm,
  type MessageEditFormProps,
  MessageFeedback,
  type MessageFeedbackProps,
  type ModelOption,
  ModelSelector,
  type ModelSelectorProps,
  type PartGroup,
  type QuickAction,
  QuickActions,
  type QuickActionsProps,
  ReasoningCard,
  RichCodeBlock,
  Shimmer,
  SkillBadge,
  type SkillBadgeProps,
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
} from "#veryfront/react/components/chat/chat.tsx";

export {
  Message as StandaloneMessage,
  type MessageProps,
  StreamingMessage,
  type StreamingMessageProps,
} from "#veryfront/react/components/chat/message.tsx";

export { AgentCard, type AgentCardProps } from "#veryfront/react/components/chat/agent-card.tsx";
export {
  ChatErrorBoundary,
  type ChatErrorBoundaryProps,
  useChatErrorHandler,
} from "#veryfront/react/components/chat/error-boundary.tsx";
export type { AgentTheme, ChatTheme } from "#veryfront/react/components/chat/theme.ts";

export {
  type BranchInfo,
  type BrowserInferenceStatus,
  type ChatDynamicToolPart,
  type ChatFinishReason,
  type ChatMessage,
  type ChatMessagePart,
  type ChatReasoningPart,
  type ChatStepPart,
  type ChatStreamEvent,
  type ChatTextPart,
  type ChatToolPart,
  type ChatToolResultPart,
  type ChatToolState,
  type InferenceMode,
  type OnToolCallArg,
  type ToolOutput,
  useChat,
  type UseChatOptions,
  type UseChatResult,
} from "#veryfront/agent/react/use-chat/index.ts";

export type {
  ChatMessageMetadata,
  ChatMessageMetadataUsage,
  ChatUiMessageChunk,
  ChildRunAudit,
  ChildRunAuditToolCall,
  ChildRunAuditToolResult,
} from "./protocol.ts";

export {
  useAgent,
  type UseAgentOptions,
  type UseAgentResult,
} from "#veryfront/agent/react/use-agent.ts";

export {
  buildChatStreamChunkMessageMetadata,
  type BuildChatStreamChunkMessageMetadataInput,
  dedupeChatUiMessageChunks,
  extractChatMessageMetadata,
  normalizeChatMessageMetadata,
  normalizeChatUiMessageChunk,
  normalizeChatUiMessageStream,
} from "./chat-ui-message-helpers.ts";

export {
  useCompletion,
  type UseCompletionOptions,
  type UseCompletionResult,
} from "#veryfront/agent/react/use-completion.ts";

export {
  useStreaming,
  type UseStreamingOptions,
  type UseStreamingResult,
} from "#veryfront/agent/react/use-streaming.ts";

export {
  useVoiceInput,
  type UseVoiceInputOptions,
  type UseVoiceInputResult,
} from "#veryfront/agent/react/use-voice-input.ts";
