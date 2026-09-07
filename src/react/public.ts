/**
 * All browser-side components, hooks, and utilities.
 *
 * Convenience barrel that aggregates every browser-only export path.
 * Individual paths (veryfront/head, veryfront/chat, etc.) continue to work.
 *
 * @module react
 *
 * @example
 * ```tsx
 * import { Chat, useChat } from "veryfront/react";
 *
 * export default function Page() {
 *   const chat = useChat();
 *   return <Chat chat={chat} />;
 * }
 * ```
 */

// ---------------------------------------------------------------------------
// Head (veryfront/head)
// ---------------------------------------------------------------------------
export { Head } from "./components/Head.tsx";

// ---------------------------------------------------------------------------
// Router (veryfront/router)
// ---------------------------------------------------------------------------
export { Link, RouterProvider, useRouter } from "./router/index.tsx";
export type { LinkProps, RouterProviderProps, RouterValue } from "./router/index.tsx";

// ---------------------------------------------------------------------------
// Context (veryfront/context)
// ---------------------------------------------------------------------------
export { PageContextProvider, usePageContext } from "./context/index.tsx";
export type { MdxHeading, PageContextProviderProps, PageContextValue } from "./context/index.tsx";

// ---------------------------------------------------------------------------
// Fonts (veryfront/fonts)
// ---------------------------------------------------------------------------
export { GoogleFonts } from "./fonts/index.ts";
export type { Font, GoogleFontsProps } from "./fonts/index.ts";

// ---------------------------------------------------------------------------
// Markdown (veryfront/markdown)
// ---------------------------------------------------------------------------
export {
  Markdown,
  MarkdownRendererCapabilityError,
  MarkdownRendererProvider,
} from "./components/chat/markdown.tsx";
export type {
  CodeBlockProps,
  MarkdownComponents,
  MarkdownElementRendererProps,
  MarkdownProps,
  MarkdownRenderer,
  MarkdownRendererProps,
  MarkdownRendererProviderProps,
} from "./components/chat/markdown.tsx";

// ---------------------------------------------------------------------------
// MDX (veryfront/mdx)
// ---------------------------------------------------------------------------
export { MDXProvider, useMDXComponents } from "./components/MDXProvider.tsx";
export type { MDXProviderProps } from "./components/MDXProvider.tsx";

// ---------------------------------------------------------------------------
// Chat — Core preset + compound
// ---------------------------------------------------------------------------
export { Chat } from "./components/chat/chat.tsx";
export type { ChatAgentInfo, ChatProps } from "./components/chat/chat.tsx";

// Chat — Composition building blocks
export {
  ChatEmpty,
  ChatIf,
  ChatInput,
  ChatInputAttach,
  ChatInputExport,
  ChatInputField,
  ChatInputModel,
  ChatInputRoot,
  ChatInputSend,
  ChatInputStop,
  ChatInputSubmit,
  ChatInputToolbar,
  ChatInputVoice,
  ChatMessageList,
  ChatRoot,
  ErrorBanner,
  Message,
  type MessageProps,
  ModelAvatar,
} from "./components/chat/chat.tsx";
export type {
  ChatEmptyProps,
  ChatIfProps,
  ChatInputActionProps,
  ChatInputAttachProps,
  ChatInputExportProps,
  ChatInputFieldProps,
  ChatInputModelProps,
  ChatInputProps,
  ChatInputRootProps,
  ChatInputSendProps,
  ChatInputSlottedActionProps,
  ChatInputSlottedSubmitProps,
  ChatInputStopProps,
  ChatInputSubmitProps,
  ChatInputToolbarProps,
  ChatInputVoiceProps,
  ChatMessageListContentProps,
  ChatMessageListProps,
  ChatRootProps,
  ErrorBannerProps,
  MessageRootProps,
  MessageTokensProps,
  ModelAvatarProps,
  TokenRowProps,
} from "./components/chat/chat.tsx";

// Chat — Contexts
export {
  ChatContextProvider,
  ChatInputContextProvider,
  MessageContextProvider,
  useChatContext,
  useChatContextOptional,
  useChatInputContext,
  useChatInputContextOptional,
  useMessageContext,
  useMessageContextOptional,
  useMessageParts,
} from "./components/chat/chat.tsx";
export type {
  ChatContextValue,
  ChatInputContextValue,
  MessageContextValue,
  MessagePartsData,
} from "./components/chat/chat.tsx";

// Chat — Conversation persistence
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
} from "./components/chat/chat.tsx";

// Chat — Sub-components
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
  isToolPart,
  Loader,
  MessageActionBar,
  MessageEditForm,
  MessageFeedback,
  ModelSelector,
  QuickActions,
  Reasoning,
  Shimmer,
  Sources,
  StepIndicator,
  Suggestion,
  Suggestions,
  TabSwitcher,
  ToolCall,
  ToolStatusBadge,
  useReasoning,
  useToolCall,
} from "./components/chat/chat.tsx";
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
} from "./components/chat/chat.tsx";

// Chat — Compound component and headless-hook parity
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
  ChatEmptyState,
  type ChatEmptyStateAvatarProps,
  type ChatEmptyStateHeadingProps,
  type ChatEmptyStateRootProps,
  type ChatEmptyStateSuggestionProps,
  type ChatEmptyStateSuggestionsProps,
  ChatMessagesSkeleton,
  type ChatMessagesSkeletonProps,
  isSkillToolPart,
  mergeProps,
  type ModelSelectorContentProps,
  type ModelSelectorContextValue,
  type ModelSelectorItemProps,
  type ModelSelectorTriggerProps,
  SkillBadge,
  type SkillBadgeProps,
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
  useUpload,
  type UseUploadOptions,
  type UseUploadResult,
} from "./components/chat/chat.tsx";

export { AgentCard } from "./components/chat/agent-card.tsx";
export type { AgentCardProps } from "./components/chat/agent-card.tsx";

export { ChatErrorBoundary, useChatErrorHandler } from "./components/chat/error-boundary.tsx";
export type { ChatErrorBoundaryProps } from "./components/chat/error-boundary.tsx";

// Theme utilities
export type { AgentTheme, ChatTheme } from "./components/chat/theme.ts";
export {
  chatButtonVariants,
  chatContainerVariants,
  cn,
  defaultAgentTheme,
  defaultChatTheme,
  mergeThemes,
  messageVariants,
} from "./components/chat/theme.ts";
export {
  ColorModeProvider,
  type ColorModeProviderProps,
  ColorModeScript,
  ColorModeToggle,
  useColorMode,
} from "./components/ui/color-mode.tsx";

// Design tokens
export { chatTokens, getChatTokensCSS } from "./components/chat/chat-tokens.ts";
export {
  ChatStyleProvider,
  type ChatStyleProviderProps,
} from "./components/chat/chat-style-provider.tsx";

// ---------------------------------------------------------------------------
// Chat — hooks (veryfront/chat)
// ---------------------------------------------------------------------------
export { useChat } from "#veryfront/agent/react/use-chat/index.ts";
export type {
  BranchInfo,
  ChatDynamicToolPart,
  ChatMessage,
  ChatMessagePart,
  ChatReasoningPart,
  ChatStepPart,
  ChatTextPart,
  ChatToolPart,
  ChatToolResultPart,
  ChatToolState,
  InferenceMode,
  OnToolCallArg,
  ToolOutput,
  UseChatError,
  UseChatOptions,
  UseChatResult,
} from "#veryfront/agent/react/use-chat/index.ts";
export type { ChatFinishReason, ChatStreamEvent } from "#veryfront/agent/react/use-chat/index.ts";

export { useAgent } from "#veryfront/agent/react/use-agent.ts";
export type { UseAgentOptions, UseAgentResult } from "#veryfront/agent/react/use-agent.ts";

export {
  getAgentPromptSuggestions,
  normalizeAgentMetadata,
  normalizeAgentMetadataResponse,
  useAgentMetadata,
} from "#veryfront/agent/react/use-agent-metadata.ts";
export type {
  AgentMetadata,
  AgentMetadataPromptSuggestion,
  AgentMetadataSuggestion,
  AgentMetadataSuggestions,
  AgentMetadataTaskSuggestion,
  UseAgentMetadataResult,
} from "#veryfront/agent/react/use-agent-metadata.ts";

export { normalizeAgentsListResponse, useAgents } from "#veryfront/agent/react/use-agents.ts";
export type { UseAgentsOptions, UseAgentsResult } from "#veryfront/agent/react/use-agents.ts";

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
