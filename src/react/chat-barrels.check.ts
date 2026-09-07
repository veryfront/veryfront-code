// Compile the browser barrels used by getDefaultImportMap. The runtime mapping
// is tested separately because the repository import map reserves
// veryfront/react for the server-capable development barrel.
import {
  Reasoning as ReactReasoning,
  ToolCall as ReactToolCall,
  useReasoning as useReactReasoning,
  useToolCall as useReactToolCall,
} from "./public.ts";
import type {
  ReasoningContextValue as ReactReasoningContextValue,
  ReasoningProps as ReactReasoningProps,
  ReasoningTriggerProps as ReactReasoningTriggerProps,
  ToolCallContextValue as ReactToolCallContextValue,
  ToolCallProps as ReactToolCallProps,
  ToolCallTriggerProps as ReactToolCallTriggerProps,
} from "./public.ts";
import {
  CONVERSATION_STORAGE_LIMITS as ReactConversationStorageLimits,
  ConversationsContextProvider as ReactConversationsContextProvider,
  ConversationsProvider as ReactConversationsProvider,
  ConversationStoreError as ReactConversationStoreError,
  localConversationStore as ReactLocalConversationStore,
  memoryConversationStore as ReactMemoryConversationStore,
  useConversation as ReactUseConversation,
  useConversationChat as ReactUseConversationChat,
  useConversations as ReactUseConversations,
  useConversationsContext as ReactUseConversationsContext,
  useConversationsContextOptional as ReactUseConversationsContextOptional,
} from "./public.ts";
import type {
  ActiveConversationLoadFailure as ReactActiveConversationLoadFailure,
  Conversation as ReactConversation,
  ConversationPatch as ReactConversationPatch,
  ConversationsContextValue as ReactConversationsContextValue,
  ConversationsProviderProps as ReactConversationsProviderProps,
  ConversationStorageLimits as ReactConversationStorageLimitsType,
  ConversationStore as ReactConversationStore,
  ConversationStoreOperation as ReactConversationStoreOperation,
  ConversationSummary as ReactConversationSummary,
  StorageLike as ReactStorageLike,
  UseChatError as ReactUseChatError,
  UseConversationChatOptions as ReactUseConversationChatOptions,
  UseConversationChatResult as ReactUseConversationChatResult,
  UseConversationOptions as ReactUseConversationOptions,
  UseConversationPersistenceState as ReactUseConversationPersistenceState,
  UseConversationResult as ReactUseConversationResult,
  UseConversationsActiveLoadState as ReactUseConversationsActiveLoadState,
  UseConversationsOptions as ReactUseConversationsOptions,
  UseConversationsPersistenceState as ReactUseConversationsPersistenceState,
  UseConversationsResult as ReactUseConversationsResult,
} from "./public.ts";
import {
  Reasoning as ChatReasoning,
  ToolCall as ChatToolCall,
  useReasoning as useChatReasoning,
  useToolCall as useChatToolCall,
} from "./components/chat/index.ts";
import type {
  ReasoningContextValue as ChatReasoningContextValue,
  ReasoningProps as ChatReasoningProps,
  ReasoningTriggerProps as ChatReasoningTriggerProps,
  ToolCallContextValue as ChatToolCallContextValue,
  ToolCallProps as ChatToolCallProps,
  ToolCallTriggerProps as ChatToolCallTriggerProps,
} from "./components/chat/index.ts";
import {
  CONVERSATION_STORAGE_LIMITS as ChatConversationStorageLimits,
  ConversationsContextProvider as ChatConversationsContextProvider,
  ConversationsProvider as ChatConversationsProvider,
  ConversationStoreError as ChatConversationStoreError,
  localConversationStore as ChatLocalConversationStore,
  memoryConversationStore as ChatMemoryConversationStore,
  useConversation as ChatUseConversation,
  useConversationChat as ChatUseConversationChat,
  useConversations as ChatUseConversations,
  useConversationsContext as ChatUseConversationsContext,
  useConversationsContextOptional as ChatUseConversationsContextOptional,
} from "./components/chat/index.ts";
import type {
  ActiveConversationLoadFailure as ChatActiveConversationLoadFailure,
  Conversation as ChatConversation,
  ConversationPatch as ChatConversationPatch,
  ConversationsContextValue as ChatConversationsContextValue,
  ConversationsProviderProps as ChatConversationsProviderProps,
  ConversationStorageLimits as ChatConversationStorageLimitsType,
  ConversationStore as ChatConversationStore,
  ConversationStoreOperation as ChatConversationStoreOperation,
  ConversationSummary as ChatConversationSummary,
  StorageLike as ChatStorageLike,
  UseConversationChatOptions as ChatUseConversationChatOptions,
  UseConversationChatResult as ChatUseConversationChatResult,
  UseConversationOptions as ChatUseConversationOptions,
  UseConversationPersistenceState as ChatUseConversationPersistenceState,
  UseConversationResult as ChatUseConversationResult,
  UseConversationsActiveLoadState as ChatUseConversationsActiveLoadState,
  UseConversationsOptions as ChatUseConversationsOptions,
  UseConversationsPersistenceState as ChatUseConversationsPersistenceState,
  UseConversationsResult as ChatUseConversationsResult,
} from "./components/chat/index.ts";

void [
  ReactReasoning,
  ReactToolCall,
  useReactReasoning,
  useReactToolCall,
  ChatReasoning,
  ChatToolCall,
  useChatReasoning,
  useChatToolCall,
  ReactConversationStorageLimits,
  ReactConversationsContextProvider,
  ReactConversationsProvider,
  ReactConversationStoreError,
  ReactLocalConversationStore,
  ReactMemoryConversationStore,
  ReactUseConversation,
  ReactUseConversationChat,
  ReactUseConversations,
  ReactUseConversationsContext,
  ReactUseConversationsContextOptional,
  ChatConversationStorageLimits,
  ChatConversationsContextProvider,
  ChatConversationsProvider,
  ChatConversationStoreError,
  ChatLocalConversationStore,
  ChatMemoryConversationStore,
  ChatUseConversation,
  ChatUseConversationChat,
  ChatUseConversations,
  ChatUseConversationsContext,
  ChatUseConversationsContextOptional,
];

export type ChatReactBarrelContracts = [
  ReactReasoningContextValue,
  ReactReasoningProps,
  ReactReasoningTriggerProps,
  ReactToolCallContextValue,
  ReactToolCallProps,
  ReactToolCallTriggerProps,
  ChatReasoningContextValue,
  ChatReasoningProps,
  ChatReasoningTriggerProps,
  ChatToolCallContextValue,
  ChatToolCallProps,
  ChatToolCallTriggerProps,
  ReactActiveConversationLoadFailure,
  ReactConversation,
  ReactConversationPatch,
  ReactConversationsContextValue,
  ReactConversationsProviderProps,
  ReactConversationStorageLimitsType,
  ReactConversationStore,
  ReactConversationStoreOperation,
  ReactConversationSummary,
  ReactStorageLike,
  ReactUseChatError,
  ReactUseConversationChatOptions,
  ReactUseConversationChatResult,
  ReactUseConversationOptions,
  ReactUseConversationPersistenceState,
  ReactUseConversationResult,
  ReactUseConversationsOptions,
  ReactUseConversationsActiveLoadState,
  ReactUseConversationsPersistenceState,
  ReactUseConversationsResult,
  ChatActiveConversationLoadFailure,
  ChatConversation,
  ChatConversationPatch,
  ChatConversationsContextValue,
  ChatConversationsProviderProps,
  ChatConversationStorageLimitsType,
  ChatConversationStore,
  ChatConversationStoreOperation,
  ChatConversationSummary,
  ChatStorageLike,
  ChatUseConversationChatOptions,
  ChatUseConversationChatResult,
  ChatUseConversationOptions,
  ChatUseConversationPersistenceState,
  ChatUseConversationResult,
  ChatUseConversationsOptions,
  ChatUseConversationsActiveLoadState,
  ChatUseConversationsPersistenceState,
  ChatUseConversationsResult,
];

type CompoundChatRuntimeExport =
  | "AgentAvatar"
  | "ChatInputContextProvider"
  | "ChatInputAttach"
  | "ChatEmptyState"
  | "ChatInputExport"
  | "ChatInputField"
  | "ChatInputModel"
  | "ChatInputRoot"
  | "ChatInputSend"
  | "ChatInputStop"
  | "ChatInputSubmit"
  | "ChatInputToolbar"
  | "ChatInputVoice"
  | "ChatMessagesSkeleton"
  | "SkillBadge"
  | "SourcePill"
  | "isSkillToolPart"
  | "mergeProps"
  | "useAttachmentPill"
  | "useAttachments"
  | "useAttachmentsPanel"
  | "useChatInput"
  | "useChatInputContext"
  | "useChatInputContextOptional"
  | "useChatScroll"
  | "useMessageBranches"
  | "useModelSelector"
  | "useSources"
  | "useStepIndicator"
  | "useUpload"
  | "useAttachments";

type ContainsRuntimeExports<TModule, TName extends PropertyKey> =
  Exclude<TName, keyof TModule> extends never ? true : never;

const compoundRuntimeParity: [
  ContainsRuntimeExports<typeof import("./public.ts"), CompoundChatRuntimeExport>,
  ContainsRuntimeExports<
    typeof import("./components/chat/index.ts"),
    CompoundChatRuntimeExport
  >,
  ContainsRuntimeExports<typeof import("../chat/index.ts"), CompoundChatRuntimeExport>,
] = [true, true, true];

void compoundRuntimeParity;

const legacyOwnedRootWithoutSetter = {
  input: "ready",
  onChange: () => undefined,
  sendMessage: () => undefined,
  children: null,
} satisfies import("../chat/index.ts").ChatInputRootProps;

const legacyMixedSubmitRoot = {
  input: "ready",
  onChange: () => undefined,
  onSubmit: () => undefined,
  sendMessage: () => undefined,
  setInput: () => undefined,
  children: null,
} satisfies import("../chat/index.ts").ChatInputRootProps;

const additiveRootCompatibilityAcrossBarrels: [
  import("./public.ts").ChatInputRootProps,
  import("./components/chat/index.ts").ChatInputRootProps,
  import("../chat/index.ts").ChatInputRootProps,
] = [legacyOwnedRootWithoutSetter, legacyMixedSubmitRoot, legacyMixedSubmitRoot];

void additiveRootCompatibilityAcrossBarrels;

export type CompoundChatPublicTypeContracts = [
  import("./public.ts").AgentAvatarProps,
  import("./public.ts").AttachmentPillContextValue,
  import("./public.ts").AttachmentsPanelActionProps,
  import("./public.ts").AttachmentsPanelContextValue,
  import("./public.ts").AttachmentsPanelEmptyProps,
  import("./public.ts").AttachmentsPanelHeaderProps,
  import("./public.ts").AttachmentsPanelItemProps,
  import("./public.ts").AttachmentsPanelListProps,
  import("./public.ts").AttachmentsPanelLoadingProps,
  import("./public.ts").ChatEmptyStateAvatarProps,
  import("./public.ts").ChatEmptyStateHeadingProps,
  import("./public.ts").ChatEmptyStateRootProps,
  import("./public.ts").ChatEmptyStateSuggestionProps,
  import("./public.ts").ChatEmptyStateSuggestionsProps,
  import("./public.ts").ChatMessagesSkeletonProps,
  import("./public.ts").ChatInputActionProps,
  import("./public.ts").ChatInputAttachProps,
  import("./public.ts").ChatInputContextValue,
  import("./public.ts").ChatInputExportProps,
  import("./public.ts").ChatInputFieldProps,
  import("./public.ts").ChatInputModelProps,
  import("./public.ts").ChatInputProps,
  import("./public.ts").ChatInputRootProps,
  import("./public.ts").ChatInputSendProps,
  import("./public.ts").ChatInputStopProps,
  import("./public.ts").ChatInputSubmitProps,
  import("./public.ts").ChatInputToolbarProps,
  import("./public.ts").ChatInputVoiceProps,
  import("./public.ts").ModelSelectorContentProps,
  import("./public.ts").ModelSelectorContextValue,
  import("./public.ts").ModelSelectorItemProps,
  import("./public.ts").ModelSelectorTriggerProps,
  import("./public.ts").SkillBadgeProps,
  import("./public.ts").SourcePillProps,
  import("./public.ts").SourcesContextValue,
  import("./public.ts").SourcesListProps,
  import("./public.ts").StepIndicatorContextValue,
  import("./public.ts").UseAttachmentsOptions,
  import("./public.ts").UseAttachmentsRequestState,
  import("./public.ts").UseAttachmentsResult,
  import("./public.ts").UseAttachmentsStorageState,
  import("./public.ts").UseChatInputResult,
  import("./public.ts").UseChatScrollOptions,
  import("./public.ts").UseChatScrollResult<HTMLElement>,
  import("./public.ts").UseMessageBranchesResult,
  import("./public.ts").UseUploadOptions,
  import("./public.ts").UseUploadResult,
  import("./public.ts").UseAttachmentsOptions,
  import("./public.ts").UseAttachmentsResult,
];

export type CompoundChatComponentTypeContracts = [
  import("./components/chat/index.ts").AgentAvatarProps,
  import("./components/chat/index.ts").AttachmentPillContextValue,
  import("./components/chat/index.ts").AttachmentsPanelActionProps,
  import("./components/chat/index.ts").AttachmentsPanelContextValue,
  import("./components/chat/index.ts").AttachmentsPanelEmptyProps,
  import("./components/chat/index.ts").AttachmentsPanelHeaderProps,
  import("./components/chat/index.ts").AttachmentsPanelItemProps,
  import("./components/chat/index.ts").AttachmentsPanelListProps,
  import("./components/chat/index.ts").AttachmentsPanelLoadingProps,
  import("./components/chat/index.ts").ChatEmptyStateAvatarProps,
  import("./components/chat/index.ts").ChatEmptyStateHeadingProps,
  import("./components/chat/index.ts").ChatEmptyStateRootProps,
  import("./components/chat/index.ts").ChatEmptyStateSuggestionProps,
  import("./components/chat/index.ts").ChatEmptyStateSuggestionsProps,
  import("./components/chat/index.ts").ChatMessagesSkeletonProps,
  import("./components/chat/index.ts").ChatInputActionProps,
  import("./components/chat/index.ts").ChatInputAttachProps,
  import("./components/chat/index.ts").ChatInputContextValue,
  import("./components/chat/index.ts").ChatInputExportProps,
  import("./components/chat/index.ts").ChatInputFieldProps,
  import("./components/chat/index.ts").ChatInputModelProps,
  import("./components/chat/index.ts").ChatInputProps,
  import("./components/chat/index.ts").ChatInputRootProps,
  import("./components/chat/index.ts").ChatInputSendProps,
  import("./components/chat/index.ts").ChatInputStopProps,
  import("./components/chat/index.ts").ChatInputSubmitProps,
  import("./components/chat/index.ts").ChatInputToolbarProps,
  import("./components/chat/index.ts").ChatInputVoiceProps,
  import("./components/chat/index.ts").ModelSelectorContentProps,
  import("./components/chat/index.ts").ModelSelectorContextValue,
  import("./components/chat/index.ts").ModelSelectorItemProps,
  import("./components/chat/index.ts").ModelSelectorTriggerProps,
  import("./components/chat/index.ts").SkillBadgeProps,
  import("./components/chat/index.ts").SourcePillProps,
  import("./components/chat/index.ts").SourcesContextValue,
  import("./components/chat/index.ts").SourcesListProps,
  import("./components/chat/index.ts").StepIndicatorContextValue,
  import("./components/chat/index.ts").UseAttachmentsOptions,
  import("./components/chat/index.ts").UseAttachmentsRequestState,
  import("./components/chat/index.ts").UseAttachmentsResult,
  import("./components/chat/index.ts").UseAttachmentsStorageState,
  import("./components/chat/index.ts").UseChatInputResult,
  import("./components/chat/index.ts").UseChatScrollOptions,
  import("./components/chat/index.ts").UseChatScrollResult<HTMLElement>,
  import("./components/chat/index.ts").UseMessageBranchesResult,
  import("./components/chat/index.ts").UseUploadOptions,
  import("./components/chat/index.ts").UseUploadResult,
  import("./components/chat/index.ts").UseAttachmentsOptions,
  import("./components/chat/index.ts").UseAttachmentsResult,
];

export type CompoundCanonicalChatTypeContracts = [
  import("../chat/index.ts").AgentAvatarProps,
  import("../chat/index.ts").AttachmentPillContextValue,
  import("../chat/index.ts").AttachmentsPanelActionProps,
  import("../chat/index.ts").AttachmentsPanelContextValue,
  import("../chat/index.ts").AttachmentsPanelEmptyProps,
  import("../chat/index.ts").AttachmentsPanelHeaderProps,
  import("../chat/index.ts").AttachmentsPanelItemProps,
  import("../chat/index.ts").AttachmentsPanelListProps,
  import("../chat/index.ts").AttachmentsPanelLoadingProps,
  import("../chat/index.ts").ChatEmptyStateAvatarProps,
  import("../chat/index.ts").ChatEmptyStateHeadingProps,
  import("../chat/index.ts").ChatEmptyStateRootProps,
  import("../chat/index.ts").ChatEmptyStateSuggestionProps,
  import("../chat/index.ts").ChatEmptyStateSuggestionsProps,
  import("../chat/index.ts").ChatMessagesSkeletonProps,
  import("../chat/index.ts").ChatInputActionProps,
  import("../chat/index.ts").ChatInputAttachProps,
  import("../chat/index.ts").ChatInputExportProps,
  import("../chat/index.ts").ChatInputFieldProps,
  import("../chat/index.ts").ChatInputModelProps,
  import("../chat/index.ts").ChatInputProps,
  import("../chat/index.ts").ChatInputRootProps,
  import("../chat/index.ts").ChatInputSendProps,
  import("../chat/index.ts").ChatInputStopProps,
  import("../chat/index.ts").ChatInputSubmitProps,
  import("../chat/index.ts").ChatInputToolbarProps,
  import("../chat/index.ts").ChatInputVoiceProps,
  import("../chat/index.ts").ModelSelectorContentProps,
  import("../chat/index.ts").ModelSelectorContextValue,
  import("../chat/index.ts").ModelSelectorItemProps,
  import("../chat/index.ts").ModelSelectorTriggerProps,
  import("../chat/index.ts").SkillBadgeProps,
  import("../chat/index.ts").SourcePillProps,
  import("../chat/index.ts").SourcesContextValue,
  import("../chat/index.ts").SourcesListProps,
  import("../chat/index.ts").StepIndicatorContextValue,
  import("../chat/index.ts").UseAttachmentsOptions,
  import("../chat/index.ts").UseAttachmentsRequestState,
  import("../chat/index.ts").UseAttachmentsResult,
  import("../chat/index.ts").UseAttachmentsStorageState,
  import("../chat/index.ts").UseUploadOptions,
  import("../chat/index.ts").UseUploadResult,
  import("../chat/index.ts").UseAttachmentsOptions,
  import("../chat/index.ts").UseAttachmentsResult,
];
