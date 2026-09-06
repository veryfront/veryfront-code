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
 *   return <Chat chat={chat} />;
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
 *       <Chat.If condition={(ctx) => ctx.isEmpty}>
 *         <Chat.Empty title="Ask me anything" />
 *       </Chat.If>
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

export {
  Chat,
  type ChatAgentInfo,
  type ChatProps,
} from "#veryfront/react/components/chat/chat.tsx";

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
} from "#veryfront/react/components/chat/chat.tsx";

export {
  ChatContextProvider,
  type ChatContextValue,
  MessageContextProvider,
  type MessageContextValue,
  type MessagePartsData,
  useChatContext,
  useChatContextOptional,
  useMessageContext,
  useMessageContextOptional,
  useMessageParts,
} from "#veryfront/react/components/chat/chat.tsx";

export {
  AgentAvatar,
  type AgentAvatarProps,
  type AttachmentInfo,
  AttachmentsPanel,
  type AttachmentsPanelActionProps,
  type AttachmentsPanelContextValue,
  type AttachmentsPanelEmptyProps,
  type AttachmentsPanelHeaderProps,
  type AttachmentsPanelItemProps,
  type AttachmentsPanelListProps,
  type AttachmentsPanelLoadingProps,
  type AttachmentsPanelProps,
  BranchPicker,
  type BranchPickerActionProps,
  type BranchPickerCountProps,
  type BranchPickerProps,
  ChatMessagesSkeleton,
  type ChatMessagesSkeletonProps,
  ChatSidebar,
  type ChatSidebarComponent,
  type ChatSidebarEmptyProps,
  type ChatSidebarGroupProps,
  type ChatSidebarItemProps,
  type ChatSidebarItemTitleProps,
  type ChatSidebarListProps,
  type ChatSidebarNewButtonProps,
  type ChatSidebarProps,
  type ChatSidebarRootProps,
  type ChatTab,
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
  type InlineCitationCardProps,
  type InlineCitationProps,
  type InlineCitationTriggerProps,
  isReasoningPart,
  isSkillToolPart,
  isToolPart,
  Loader,
  MessageActionBar,
  type MessageActionBarActionProps,
  type MessageActionBarProps,
  MessageEditForm,
  type MessageEditFormProps,
  MessageFeedback,
  type MessageFeedbackActionProps,
  type MessageFeedbackProps,
  type ModelOption,
  ModelSelector,
  type ModelSelectorContentProps,
  type ModelSelectorContextValue,
  type ModelSelectorItemProps,
  type ModelSelectorProps,
  type ModelSelectorSearchProps,
  type ModelSelectorTriggerProps,
  type PartGroup,
  type QuickAction,
  QuickActions,
  type QuickActionsProps,
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
  ToolStatusBadge,
  type UploadedFile,
  useAttachments,
  type UseAttachmentsOptions,
  useAttachmentsPanel,
  type UseAttachmentsRequestState,
  type UseAttachmentsResult,
  type UseAttachmentsStorageState,
  useChatSidebarItem,
  useModelSelector,
  useSources,
  useStepIndicator,
  useUpload,
  type UseUploadOptions,
  type UseUploadResult,
} from "#veryfront/react/components/chat/chat.tsx";

// Conversation persistence adapters and hooks. localStorage is the convenience
// default; custom stores can provide IndexedDB, API, or application persistence.
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
  useConversationChat,
  type UseConversationChatOptions,
  type UseConversationChatResult,
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
} from "#veryfront/react/components/chat/chat.tsx";

// ---------------------------------------------------------------------------
// Canonical component names.
// ---------------------------------------------------------------------------
export {
  AttachmentPill,
  type AttachmentPillContextValue,
  type AttachmentPillProps,
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
// RFC 2980 canonical hook + context surface.
export {
  ChatInputContextProvider,
  type ChatInputContextValue,
  mergeProps,
  useChatInput,
  useChatInputContext,
  useChatInputContextOptional,
  type UseChatInputResult,
  useChatScroll,
  type UseChatScrollOptions,
  type UseChatScrollResult,
  useMessageBranches,
  type UseMessageBranchesResult,
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
  type AgentPickerActionProps,
  type AgentPickerContentProps,
  type AgentPickerContextValue,
  type AgentPickerItemProps,
  type AgentPickerProps,
  type AgentPickerSearchProps,
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
  type ChatActionsSlottedTriggerProps,
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
  type UseChatError,
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
  getAgentPromptSuggestionItems,
  getAgentPromptSuggestions,
  normalizeAgentMetadata,
  normalizeAgentMetadataResponse,
  type PromptSuggestion,
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
