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
 *   const chat = useChat();
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
 *   const chat = useChat();
 *   return (
 *     <Chat.Root messages={chat.messages} input={chat.input}>
 *       <Chat.Empty title="Ask me anything" />
 *       <Chat.MessageList messages={chat.messages} />
 *       <Chat.Input input={chat.input} onChange={chat.handleInputChange} onSubmit={chat.handleSubmit} />
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
} from "#veryfront/react/components/chat/chat.tsx";

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
} from "#veryfront/react/components/chat/chat.tsx";

export {
  AgentAvatar,
  type AgentAvatarProps,
  type AttachmentInfo,
  AttachmentsPanel,
  type AttachmentsPanelActionProps,
  type AttachmentsPanelContextValue,
  type AttachmentsPanelEmptyProps,
  type AttachmentsPanelItemProps,
  type AttachmentsPanelListProps,
  type AttachmentsPanelLoadingProps,
  type AttachmentsPanelProps,
  BranchPicker,
  type BranchPickerProps,
  ChatMessagesSkeleton,
  type ChatMessagesSkeletonProps,
  ChatSidebar,
  type ChatSidebarComponent,
  type ChatSidebarEmptyProps,
  type ChatSidebarGroupProps,
  type ChatSidebarIcons,
  type ChatSidebarItemProps,
  type ChatSidebarListProps,
  type ChatSidebarNewButtonProps,
  type ChatSidebarProps,
  type ChatSidebarRootProps,
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
  isSkillToolPart,
  isToolPart,
  Loader,
  MessageActionBar,
  type MessageActionBarProps,
  MessageEditForm,
  type MessageEditFormProps,
  MessageFeedback,
  type MessageFeedbackProps,
  type ModelOption,
  ModelSelector,
  type ModelSelectorContentProps,
  type ModelSelectorContextValue,
  type ModelSelectorItemProps,
  type ModelSelectorProps,
  type ModelSelectorTriggerProps,
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
  SourcePill,
  type SourcePillProps,
  Sources,
  type SourcesContextValue,
  type SourcesListProps,
  type SourcesProps,
  StepIndicator,
  type StepIndicatorContextValue,
  type StepIndicatorProps,
  Suggestion,
  type SuggestionProps,
  Suggestions,
  type SuggestionsProps,
  TabSwitcher,
  type TabSwitcherProps,
  ToolCallCard,
  ToolStatusBadge,
  type UploadedFile,
  useAttachmentsPanel,
  useModelSelector,
  useSources,
  useStepIndicator,
  useStickToBottom,
  type UseStickToBottomOptions,
  type UseStickToBottomResult,
  useUpload,
  type UseUploadOptions,
  type UseUploadResult,
  useUploadsRegistry,
  type UseUploadsRegistryOptions,
  type UseUploadsRegistryResult,
} from "#veryfront/react/components/chat/chat.tsx";

// Conversation persistence adapters — swappable async stores behind the
// (upcoming) `useConversations` hook. localStorage default; idb/api are follow-ups.
export {
  type Conversation,
  type ConversationPatch,
  ConversationsContextProvider,
  ConversationsProvider,
  type ConversationsProviderProps,
  type ConversationStore,
  type ConversationSummary,
  localConversationStore,
  memoryConversationStore,
  type StorageLike,
  useConversation,
  type UseConversationOptions,
  type UseConversationResult,
  useConversations,
  useConversationsContext,
  useConversationsContextOptional,
  type UseConversationsOptions,
  type UseConversationsResult,
} from "#veryfront/react/components/chat/chat.tsx";

// ---------------------------------------------------------------------------
// Target component names. This chat surface intentionally completes the
// migration away from the old Thread, Composer, and standalone message exports.
// Use these names for new code and see the chat UI guide for migration notes.
// ---------------------------------------------------------------------------
export {
  AttachmentPill,
  AttachmentPill as Attachment,
  type AttachmentPillContextValue,
  type AttachmentPillProps,
  type AttachmentPillProps as AttachmentProps,
  AttachmentsPanel as UploadsPanel,
  type AttachmentsPanelProps as UploadsPanelProps,
  ChatInput,
  ChatInput as ChatComposer,
  type ChatInputProps,
  type ChatInputProps as ChatComposerProps,
  Message as StandaloneMessage,
  Message as StreamingMessage,
  MessageActionBar as MessageActions,
  type MessageActionBarProps as MessageActionsProps,
  type MessageProps as StandaloneMessageProps,
  type MessageProps as StreamingMessageProps,
  Reasoning,
  type ReasoningContextValue,
  type ReasoningProps,
  type ReasoningTriggerProps,
  ToolCall,
  type ToolCallContextValue,
  type ToolCallProps,
  type ToolCallTriggerProps,
  useAttachmentPill,
  useReasoning,
  useToolCall,
} from "#veryfront/react/components/chat/chat.tsx";
export { Markdown, type MarkdownProps } from "#veryfront/react/components/chat/markdown.tsx";

// Layout primitives — chat-independent, re-exported from the `veryfront/ui`
// package (their home) so consuming apps can compose their own shell (sidebar
// in the layout, pages in the content slot) straight from `veryfront/chat`.
export {
  AppShell,
  type AppShellHeaderProps,
  type AppShellOpenState,
  type AppShellProps,
  type AppShellSide,
  type AppShellSidebarProps,
  type AppShellTriggerProps,
  useAppShell,
} from "#veryfront/react/components/ui/app-shell.tsx";
export {
  Tabs,
  TabsItem,
  type TabsItemProps,
  type TabsProps,
} from "#veryfront/react/components/ui/tabs.tsx";
export {
  ChatThemeScope,
  type ChatThemeScopeProps,
} from "#veryfront/react/components/chat/chat-theme-scope.tsx";

// New target components (Studio 1:1, dependency-light forks).
export {
  type AgentOption,
  AgentPicker,
  type AgentPickerContentProps,
  type AgentPickerContextValue,
  type AgentPickerItemProps,
  type AgentPickerProps,
  type AgentPickerSection,
  type AgentPickerTriggerProps,
  useAgentPicker,
} from "#veryfront/react/components/chat/agent-picker.tsx";
export {
  agentsToPickerOptions,
  ChatAgentPicker,
  type ChatAgentPickerProps,
} from "#veryfront/react/components/chat/chat-agent-picker.tsx";
export {
  type ChatActionItem,
  ChatActions,
  type ChatActionsContentProps,
  type ChatActionsContextValue,
  type ChatActionsItemProps,
  type ChatActionsProps,
  type ChatActionsSettings,
  type ChatActionsTriggerProps,
  useChatActions,
} from "#veryfront/react/components/chat/chat-actions.tsx";
// `SkillTool` retired as a standalone export — a skill tool is now a presentation
// variant of `ToolCall` (`<ToolCall variant="compact" />`, auto-default for skill
// parts). The row impl stays internal to `tool-ui.tsx`.
// Shared syntax-highlight primitive (`CodeBlockProps` name is already taken by
// the Markdown code-block props, so only the runtime `CodeBlock` is re-exported).
export {
  CodeBlock,
  CodeSurface,
  type CodeSurfaceProps,
  CopyButton,
  type CopyButtonProps,
  useClipboard,
  type UseClipboardResult,
} from "#veryfront/react/components/ui/code-block.tsx";

export {
  AgentCard,
  type AgentCardContextValue,
  type AgentCardProps,
  useAgentCard,
} from "#veryfront/react/components/chat/agent-card.tsx";
export {
  ChatErrorBoundary,
  type ChatErrorBoundaryProps,
  useChatErrorHandler,
} from "#veryfront/react/components/chat/error-boundary.tsx";
export type { AgentTheme, ChatTheme } from "#veryfront/react/components/chat/theme.ts";

export {
  type BranchInfo,
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
  type AgentMetadata,
  type AgentMetadataPromptSuggestion,
  type AgentMetadataSuggestion,
  type AgentMetadataSuggestions,
  type AgentMetadataTaskSuggestion,
  getAgentPromptSuggestions,
  normalizeAgentMetadata,
  normalizeAgentMetadataResponse,
  useAgentMetadata,
  type UseAgentMetadataResult,
} from "#veryfront/agent/react/use-agent-metadata.ts";

export {
  normalizeAgentsListResponse,
  useAgents,
  type UseAgentsOptions,
  type UseAgentsResult,
} from "#veryfront/agent/react/use-agents.ts";

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
  type HostedStreamPartForUiChunkMapping,
  type HostedUiChunkMappingOptions,
  mapHostedStreamPartToChatUiChunks,
} from "./hosted-ui-chunk-mapping.ts";

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

export {
  ChatStreamIdleTimeoutError,
  type ChatStreamWatchdogOptions,
  type ChatStreamWatchdogPhase,
  type ChatStreamWatchdogState,
  createChatStreamWatchdog,
  createChatStreamWatchdogState,
  DEFAULT_CHAT_STREAM_IDLE_TIMEOUT_MS,
  DEFAULT_CHAT_STREAM_TOOL_RUNNING_TIMEOUT_MS,
  getNextChatStreamWatchdogState,
  isHeartbeatOnlyMetadataChunk,
  isLongRunningToolRunning,
} from "./stream-watchdog.ts";
