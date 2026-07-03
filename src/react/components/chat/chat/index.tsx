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
import { useChat, useVoiceInput } from "#veryfront/agent/react";
import { useAgentMetadata } from "#veryfront/agent/react/use-agent-metadata.ts";
import type { AgentMetadata } from "#veryfront/agent/react/use-agent-metadata.ts";
import type {
  BranchInfo,
  ChatDynamicToolPart,
  ChatFilePart,
  ChatMessage,
  ChatToolPart,
  InferenceMode,
} from "#veryfront/agent/react";
import { type ChatTheme, defaultChatTheme, mergeThemes } from "../theme.ts";
import type { ModelOption } from "../model-selector.tsx";
import type { Source } from "./components/sources.tsx";
import type { AttachmentInfo } from "./components/attachment-pill.tsx";
import { useUpload } from "./hooks/use-upload.ts";
import type { FeedbackValue } from "./components/message-feedback.tsx";
import type { ChatTab } from "./components/tab-switcher.tsx";
import type { UploadedFile } from "./components/attachments-panel.tsx";
import type { QuickAction } from "./components/quick-actions.tsx";

// Composition imports (used in the Chat preset)
import { ChatRoot } from "./composition/chat-root.tsx";
import { ChatInput } from "./composition/chat-composer.tsx";
import { ChatMessageList } from "./composition/chat-message-list.tsx";
import { ChatEmpty } from "./composition/chat-empty.tsx";
import { AgentAvatar } from "./composition/agent-avatar.tsx";
import { ChatIf } from "./composition/chat-if.tsx";
import { ErrorBanner } from "./composition/error-banner.tsx";
import { Message } from "./composition/message.tsx";
import { ChatMessagesSkeleton } from "./components/chat-messages-skeleton.tsx";
import { TabSwitcher } from "./components/tab-switcher.tsx";
import { AttachmentsPanel } from "./components/attachments-panel.tsx";
import { InferenceBadge } from "./components/inference-badge.tsx";
import { QuickActions as QuickActionsComponent } from "./components/quick-actions.tsx";

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
  type ChatSidebarItemProps,
  type ChatSidebarListProps,
  type ChatSidebarNewButtonProps,
  type ChatSidebarProps,
  type ChatSidebarRootProps,
  type ChatSidebarThreadItemRenderOptions,
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
  type AttachmentsPanelProps,
  type UploadedFile,
  useAttachmentsPanel,
} from "./components/attachments-panel.tsx";

// Re-exports — hooks
export {
  type Thread,
  useThreads,
  type UseThreadsOptions,
  type UseThreadsResult,
} from "./hooks/use-threads.ts";

export {
  type ConversationPatch,
  useConversations,
  type UseConversationsOptions,
  type UseConversationsResult,
} from "./hooks/use-conversations.ts";

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
  ThreadListContextProvider,
  type ThreadListContextValue,
  ThreadsProvider,
  type ThreadsProviderProps,
  useChatContext,
  useChatContextOptional,
  useComposerContext,
  useComposerContextOptional,
  useMessageContext,
  useMessageContextOptional,
  useThreadListContext,
  useThreadListContextOptional,
} from "./contexts/index.ts";

// ---------------------------------------------------------------------------
// ChatProps — Preset interface
// ---------------------------------------------------------------------------

/** Props accepted by chat. */
export interface ChatProps {
  // --- App mode (uncontrolled) ---------------------------------------------
  // When `messages`/`input` are omitted, `<Chat>` self-drives `useChat` +
  // `useAgentMetadata` internally, so the consumer writes just
  // `<Chat agentId="…" api="/api/ag-ui" />`. These props configure that mode
  // and are ignored in the controlled mode below.
  /** Agent id — fetches avatar/name/suggestions and scopes the request. */
  agentId?: string;
  /** AG-UI endpoint for the self-driven `useChat`. @default "/api/ag-ui" */
  api?: string;
  /** Seed messages for the self-driven thread. */
  initialMessages?: ChatMessage[];
  /** Error callback for the self-driven `useChat`. */
  onError?: (error: Error) => void;

  // --- Controlled mode ------------------------------------------------------
  // Pass `messages` + `input` to drive `<Chat>` yourself (back-compat).
  messages?: ChatMessage[];
  input?: string;
  onChange?: (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => void;
  onSubmit?: (e?: React.FormEvent) => void | Promise<void>;
  /**
   * Send a message (text + optional file parts). In controlled mode `<Chat>`
   * uses this to fold self-managed attachments into the submitted turn — spread
   * a `useChat()` result (`{...chat}`) and uploads work with no extra wiring.
   */
  sendMessage?: (
    message: { text: string; files?: ChatFilePart[] },
  ) => void | Promise<void>;
  stop?: () => void;
  reload?: () => void;
  setInput?: (value: string) => void;
  isLoading?: boolean;
  error?: Error | null;
  placeholder?: string;
  maxHeight?: string;
  className?: string;
  theme?: Partial<ChatTheme>;
  renderMessage?: (message: ChatMessage) => React.ReactNode;
  renderTool?: (tool: ChatToolPart | ChatDynamicToolPart) => React.ReactNode;
  suggestions?: string[];
  onSuggestionClick?: (suggestion: string) => void;
  /**
   * Opt-in idle hero for an empty thread (icon + title + optional blurb, plus
   * `suggestions`). When omitted, an empty thread renders as a blank canvas +
   * composer — no "What can I help with?" placeholder. Compose `Chat.Empty`
   * directly for full control.
   */
  emptyState?: {
    icon?: React.ReactNode;
    title?: string;
    description?: string;
  };
  /**
   * The thread is still loading its initial history → render the skeleton
   * instead of the idle empty state. In app mode (`agentId`) this is derived
   * automatically while the agent metadata resolves, so the generic
   * "What can I help with?" never flashes before the agent loads. Set it
   * yourself in controlled mode.
   */
  initializing?: boolean;
  /** Override the loading skeleton (defaults to `<Chat.Skeleton />`). */
  skeleton?: React.ReactNode;
  /**
   * Agent identity fallback for assistant message headers when a message's own
   * metadata omits `agentName` / `agentAvatarUrl`. In app mode (`agentId`) this
   * is filled from agent metadata automatically.
   */
  agent?: { name?: string; avatarUrl?: string };
  showScrollButton?: boolean;
  showMessageActions?: boolean;
  models?: ModelOption[];
  model?: string;
  /** The actual resolved model used for avatar display. */
  activeModel?: string;
  onModelChange?: (model: string) => void;
  inferenceMode?: InferenceMode;
  showSources?: boolean;
  onSourceClick?: (source: Source, index: number) => void;
  /**
   * The composer's `+` menu and drag-to-attach are on by default — `<Chat>`
   * keeps the pending files itself unless you wire the attachment props below.
   * Set `false` to hide the attach control entirely.
   */
  enableAttachments?: boolean;
  /**
   * Endpoint that pending files POST to (multipart `file`) → `{ url }`. When
   * omitted, attachments are inlined as base64 `data:` URLs (no backend
   * required); set this to store files durably (e.g. `"/api/uploads"`).
   */
  uploadApi?: string;
  onAttach?: (files: FileList) => void;
  onSelectAttachment?: () => void;
  onDrop?: (files: FileList) => void;
  attachAccept?: string;
  attachments?: AttachmentInfo[];
  onRemoveAttachment?: (id: string) => void;
  showExport?: boolean;
  onFeedback?: (messageId: string, feedback: FeedbackValue) => void;
  editMessage?: (messageId: string, newText: string) => Promise<void>;
  getBranches?: (messageId: string) => BranchInfo;
  switchBranch?: (messageId: string, branchIndex: number) => void;
  showSteps?: boolean;
  showTabs?: boolean;
  activeTab?: ChatTab;
  onTabChange?: (tab: ChatTab) => void;
  uploads?: UploadedFile[];
  onRemoveUpload?: (id: string) => void;
  quickActions?: QuickAction[];
  onQuickAction?: (action: QuickAction) => void;
  enableVoice?: boolean;
  onVoice?: () => void;
  /** Leading composer-toolbar slot (e.g. an `<AgentPicker>`). */
  toolbarStart?: React.ReactNode;
  /** @internal Hide the built-in TabSwitcher when rendered externally */
  hideTabSwitcher?: boolean;
  children?: React.ReactNode;
}

// ---------------------------------------------------------------------------
// Chat — Preset component
//
// Composes ChatRoot, ChatMessageList, ChatInput, ChatEmpty, etc. into a
// full-featured chat UI with sensible defaults. For custom layouts, use the
// building blocks directly.
// ---------------------------------------------------------------------------

/** Render the controlled chat (caller supplies `messages`/`input`). */
const ControlledChat = React.forwardRef<HTMLDivElement, ChatProps>(
  function ControlledChat(
    {
      messages = [],
      input = "",
      onChange = () => {},
      onSubmit,
      sendMessage,
      stop,
      reload,
      enableVoice = false,
      onVoice,
      setInput,
      isLoading,
      error,
      placeholder = "Type a message...",
      maxHeight = "100%",
      className,
      theme: userTheme,
      renderMessage,
      renderTool,
      suggestions,
      onSuggestionClick,
      emptyState,
      initializing = false,
      skeleton,
      agent,
      showScrollButton = false,
      showMessageActions = true,
      models,
      model,
      activeModel,
      onModelChange,
      inferenceMode,
      showSources = false,
      onSourceClick,
      enableAttachments = true,
      uploadApi,
      onAttach,
      onSelectAttachment,
      onDrop,
      attachAccept,
      attachments,
      onRemoveAttachment,
      showExport = false,
      onFeedback,
      editMessage,
      getBranches,
      switchBranch,
      showSteps = false,
      showTabs = false,
      activeTab: controlledTab,
      onTabChange: controlledTabChange,
      uploads,
      onRemoveUpload,
      quickActions,
      onQuickAction,
      toolbarStart,
      hideTabSwitcher = false,
      children,
    },
    ref,
  ): React.ReactElement {
    const theme = React.useMemo(
      () => mergeThemes(defaultChatTheme, userTheme),
      [
        userTheme,
      ],
    );

    // --- Attachments (batteries-included) ---
    // The composer's `+` menu and drag-to-attach are on by default: when the
    // caller wires none of the attachment props, `<Chat>` manages the pending
    // files itself so `<Chat />` "just works". Pass any attachment prop to take
    // control; pass `enableAttachments={false}` to hide the control entirely.
    const isAttachControlled = onAttach !== undefined ||
      onDrop !== undefined ||
      attachments !== undefined ||
      onRemoveAttachment !== undefined ||
      onSelectAttachment !== undefined;
    // When the caller wires no attachment props, `<Chat>` self-manages pending
    // files through `useUpload` — the SAME hook app-mode uses — so drag/`+`
    // uploads get an instant thumbnail (`preview`) and a resolved `url` (base64
    // `data:` by default, or a durable POST when `uploadApi` is set). The old
    // path only recorded name/size, so pills had no preview and never sent.
    const upload = useUpload({ api: uploadApi });
    const manageAttachments = enableAttachments && !isAttachControlled;

    const effectiveOnAttach = !enableAttachments
      ? undefined
      : isAttachControlled
      ? onAttach
      : upload.upload;
    const effectiveOnDrop = !enableAttachments
      ? undefined
      : isAttachControlled
      ? onDrop
      : upload.upload;
    const effectiveAttachments = isAttachControlled ? attachments : upload.attachments;
    const effectiveOnRemove = !enableAttachments
      ? undefined
      : isAttachControlled
      ? onRemoveAttachment
      : upload.remove;

    // Self-managed attachments must ride along on submit: the caller's
    // `onSubmit` only carries the input text, so fold the uploaded files into
    // `sendMessage({ text, files })` (then clear). Falls back to `onSubmit` for
    // a text-only turn, when the caller controls attachments, or when no
    // `sendMessage` is available.
    const handleSubmit = React.useCallback((e?: React.FormEvent) => {
      if (manageAttachments && sendMessage) {
        const files = attachmentsToFileParts(upload.attachments);
        if (files.length > 0) {
          e?.preventDefault();
          void sendMessage({ text: input.trim(), files });
          setInput?.("");
          upload.clear();
          return;
        }
      }
      onSubmit?.(e);
    }, [manageAttachments, sendMessage, upload, input, setInput, onSubmit]);

    // --- Tab state ---
    const [internalTab, setInternalTab] = React.useState<ChatTab>("chat");
    const currentTab = controlledTab ?? internalTab;
    const handleTabChange = controlledTabChange ?? setInternalTab;

    // --- Voice ---
    const voice = useVoiceInput({
      onTranscript: (transcript, isFinal) => {
        if (!isFinal || !setInput) return;
        setInput(transcript);
      },
    });

    const voiceHandler = React.useMemo(() => {
      if (onVoice) return onVoice;
      if (enableVoice && voice.isSupported && setInput) return voice.toggle;
      return undefined;
    }, [onVoice, enableVoice, voice.isSupported, voice.toggle, setInput]);

    const isEmpty = messages.length === 0;
    const isDocsTab = showTabs && currentTab === "attachments";

    return (
      <ChatRoot
        ref={ref}
        messages={messages}
        input={input}
        isLoading={isLoading}
        error={error}
        setInput={setInput}
        onSubmit={handleSubmit}
        onStop={stop}
        onReload={reload}
        model={model}
        models={models}
        onModelChange={onModelChange}
        agent={agent}
        attachments={effectiveAttachments}
        onAttach={effectiveOnAttach}
        onRemoveAttachment={effectiveOnRemove}
        editMessage={editMessage}
        getBranches={getBranches}
        switchBranch={switchBranch}
        onFeedback={onFeedback}
        showSources={showSources}
        onSourceClick={onSourceClick}
        theme={userTheme}
        maxHeight={maxHeight}
        className={className}
      >
        {showTabs && !hideTabSwitcher && (
          <TabSwitcher activeTab={currentTab} onTabChange={handleTabChange} />
        )}

        {isDocsTab
          ? (
            <AttachmentsPanel
              uploads={uploads}
              onRemoveUpload={onRemoveUpload}
              onAttach={effectiveOnAttach}
              attachAccept={attachAccept}
              onClose={() => handleTabChange("chat")}
              className="flex-1 min-h-0"
            />
          )
          : isEmpty && (isLoading || initializing)
          // Thread still loading its history (or agent metadata still
          // resolving) → skeleton, not an idle placeholder.
          ? (skeleton ?? <ChatMessagesSkeleton />)
          : isEmpty && emptyState
          // Idle hero is opt-in: only rendered when the consumer supplies an
          // `emptyState`. Otherwise an empty thread is just a blank canvas +
          // composer — no "What can I help with?" placeholder.
          ? (
            <ChatEmpty
              icon={emptyState.icon}
              title={emptyState.title}
              description={emptyState.description}
              suggestions={suggestions}
              onSuggestionClick={onSuggestionClick}
            />
          )
          : (
            <ChatMessageList
              messages={messages}
              isLoading={isLoading}
              theme={theme}
              renderMessage={renderMessage}
              renderTool={renderTool}
              model={activeModel || model}
              showMessageActions={showMessageActions}
              showSources={showSources}
              showSteps={showSteps}
              showScrollButton={showScrollButton}
              onSourceClick={onSourceClick}
              inferenceMode={inferenceMode}
              editMessage={editMessage}
              getBranches={getBranches}
              switchBranch={switchBranch}
              onFeedback={onFeedback}
            />
          )}

        {error && <ErrorBanner error={error} onRetry={reload} />}

        {!isDocsTab && (
          <ChatInput
            input={voice.isListening ? voice.transcript || input : input}
            onChange={onChange}
            onSubmit={handleSubmit}
            isLoading={isLoading}
            placeholder={voice.isListening ? "Listening..." : placeholder}
            theme={theme}
            stop={voice.isListening ? undefined : stop}
            onVoice={voiceHandler}
            isListening={voice.isListening}
            transcript={voice.transcript}
            models={models}
            model={model}
            onModelChange={onModelChange}
            onAttach={effectiveOnAttach}
            onSelectAttachment={onSelectAttachment}
            onDrop={effectiveOnDrop}
            attachAccept={attachAccept}
            attachments={effectiveAttachments}
            onRemoveAttachment={effectiveOnRemove}
            showExport={showExport}
            messages={messages}
            toolbarStart={toolbarStart}
          >
            {inferenceMode && inferenceMode !== "cloud" && (
              <InferenceBadge inferenceMode={inferenceMode} />
            )}
            {isEmpty && quickActions && quickActions.length > 0 && (
              <QuickActionsComponent
                actions={quickActions}
                onActionClick={onQuickAction}
              />
            )}
          </ChatInput>
        )}

        {children}
      </ChatRoot>
    );
  },
);
ControlledChat.displayName = "ControlledChat";

// ---------------------------------------------------------------------------
// UncontrolledChat — "app mode": self-drives useChat + useAgentMetadata so the
// consumer writes only `<Chat agentId="…" api="…" />`.
// ---------------------------------------------------------------------------

interface AgentSuggestionItem {
  /** Short chip label — the agent's `title`, falling back to the prompt. */
  label: string;
  /** Full text sent to the agent when the chip is clicked. */
  prompt: string;
}

/**
 * Map agent-metadata suggestions to `{ label, prompt }`. The chip shows the
 * short `title` ("Triage login issue") while the click sends the full `prompt`
 * ("Triage a customer who cannot sign in after a release.") — so the empty
 * state stays scannable without truncating what the agent actually receives.
 */
function agentSuggestionItems(
  suggestions: AgentMetadata["suggestions"] | undefined,
): AgentSuggestionItem[] {
  const list = suggestions?.suggestions;
  if (!Array.isArray(list)) return [];
  return list.flatMap((s) => {
    if (s.type !== "prompt" || !("prompt" in s) || !s.prompt) return [];
    const title = (s as { title?: unknown }).title;
    const label = typeof title === "string" && title.length > 0 ? title : s.prompt;
    return [{ label, prompt: s.prompt }];
  });
}

/**
 * Map uploaded attachments to `file` message parts. Only attachments that
 * finished uploading (have a resolved `url`) are sent — pending/errored ones
 * are skipped so a half-uploaded file never reaches the agent.
 */
function attachmentsToFileParts(items: AttachmentInfo[]): ChatFilePart[] {
  return items
    .filter((a): a is AttachmentInfo & { url: string } => Boolean(a.url))
    .map((a) => ({
      type: "file",
      mediaType: a.type ?? "application/octet-stream",
      url: a.url,
      filename: a.name,
      ...(a.size != null ? { size: a.size } : {}),
    }));
}

const UncontrolledChat = React.forwardRef<HTMLDivElement, ChatProps>(
  function UncontrolledChat(
    {
      agentId,
      api = "/api/ag-ui",
      initialMessages,
      onError,
      models,
      suggestions: suggestionsProp,
      onSuggestionClick,
      emptyState,
      // App mode defaults the scroll-to-bottom button on (batteries-included).
      showScrollButton = true,
      // Attachments: default-wired through `useUpload` unless the caller
      // controls them. With no `uploadApi`, files inline as base64 `data:` URLs
      // (guest mode — zero backend). Set `uploadApi` to POST to a durable
      // upload endpoint (multipart `file` → `{ url }`) for real users + a project.
      uploadApi,
      enableAttachments = true,
      onAttach: userOnAttach,
      onDrop: userOnDrop,
      attachments: userAttachments,
      onRemoveAttachment: userOnRemoveAttachment,
      onSubmit: userOnSubmit,
      ...rest
    },
    ref,
  ): React.ReactElement {
    const chat = useChat({
      api,
      initialMessages,
      onError,
      body: agentId ? { agentId } : undefined,
    });
    const { agent, error: agentError } = useAgentMetadata(agentId);

    // App mode owns the loading signal: from the very first paint until the
    // agent resolves (or errors) we render the skeleton — never flash an idle
    // placeholder first. Keyed off "agent not yet here" rather than the hook's
    // `isLoading` flag so there's no one-frame gap on mount. Works out of the
    // box — no `isLoading` wiring from the consumer.
    const agentInitializing = Boolean(agentId) && !agent && !agentError;

    // Agent-driven empty state: avatar + name + description, shown once the
    // agent resolves (the skeleton covers the load, so the generic
    // "What can I help with?" placeholder never flashes). A consumer-supplied
    // `emptyState` still wins.
    const derivedEmptyState = React.useMemo(() => {
      if (emptyState) return emptyState;
      if (!agent) return undefined;
      return {
        icon: (
          <AgentAvatar
            name={agent.name}
            avatarUrl={agent.avatarUrl ?? undefined}
            className="size-12"
          />
        ),
        title: agent.name,
        description: agent.description ?? undefined,
      };
    }, [emptyState, agent]);

    // Chips show the short `title`; the click sends the full `prompt`.
    const suggestionItems = React.useMemo(
      () => agentSuggestionItems(agent?.suggestions),
      [agent],
    );
    const derivedSuggestions = suggestionsProp ??
      (suggestionItems.length > 0 ? suggestionItems.map((s) => s.label) : undefined);

    const handleSuggestion = onSuggestionClick ??
      ((label: string) => {
        const item = suggestionItems.find((s) => s.label === label);
        void chat.sendMessage({ text: item?.prompt ?? label });
      });

    // Batteries-included attachments: unless the caller controls them, files
    // uploaded via the `+` menu / drag land here, ride along on submit as
    // `file` parts, and clear once sent.
    const upload = useUpload({ api: uploadApi });
    const attachControlled = userOnAttach !== undefined ||
      userOnDrop !== undefined ||
      userAttachments !== undefined ||
      userOnRemoveAttachment !== undefined;
    const manageAttachments = enableAttachments && !attachControlled;

    const submitWithAttachments = React.useCallback((e?: React.FormEvent) => {
      e?.preventDefault();
      if (chat.isLoading) return;
      const text = chat.input.trim();
      const files = attachmentsToFileParts(upload.attachments);
      if (!text && files.length === 0) return;
      chat.setInput("");
      upload.clear();
      void chat.sendMessage({ text, files });
    }, [chat, upload]);

    return (
      <ControlledChat
        ref={ref}
        messages={chat.messages}
        input={chat.input}
        onChange={chat.onChange}
        onSubmit={manageAttachments ? submitWithAttachments : (userOnSubmit ?? chat.onSubmit)}
        stop={chat.stop}
        reload={() => void chat.reload()}
        setInput={chat.setInput}
        isLoading={chat.isLoading}
        error={chat.error}
        model={chat.model}
        activeModel={chat.activeModel}
        onModelChange={chat.onModelChange}
        inferenceMode={chat.inferenceMode}
        models={models}
        editMessage={chat.editMessage}
        getBranches={chat.getBranches}
        switchBranch={chat.switchBranch}
        emptyState={derivedEmptyState}
        agent={agent ? { name: agent.name, avatarUrl: agent.avatarUrl ?? undefined } : undefined}
        initializing={agentInitializing}
        suggestions={derivedSuggestions}
        onSuggestionClick={handleSuggestion}
        showScrollButton={showScrollButton}
        enableAttachments={enableAttachments}
        onAttach={manageAttachments ? upload.upload : userOnAttach}
        onDrop={manageAttachments ? upload.upload : userOnDrop}
        attachments={manageAttachments ? upload.attachments : userAttachments}
        onRemoveAttachment={manageAttachments ? upload.remove : userOnRemoveAttachment}
        {...rest}
      />
    );
  },
);
UncontrolledChat.displayName = "UncontrolledChat";

/**
 * Chat — batteries-included chat surface.
 *
 * - **App mode (uncontrolled):** omit `messages`/`input` and pass `agentId` +
 *   `api`; `<Chat>` wires `useChat` + `useAgentMetadata` internally.
 * - **Controlled mode:** pass `messages` + `input` to drive it yourself.
 */
const ChatBase = React.forwardRef<HTMLDivElement, ChatProps>(function Chat(
  props,
  ref,
): React.ReactElement {
  // Controlled when the caller supplies the message/input state; otherwise the
  // component self-drives (app mode).
  const isControlled = props.messages !== undefined &&
    props.input !== undefined;
  return isControlled
    ? <ControlledChat ref={ref} {...props} />
    : <UncontrolledChat ref={ref} {...props} />;
});
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
  Empty: ChatEmpty,
  Skeleton: ChatMessagesSkeleton,
  If: ChatIf,
  Message: Message,
  ErrorBanner: ErrorBanner,
});

/** @deprecated Back-compat alias — `Chat` is now the compound itself. */
export const ChatComponents: ChatComponentsType = Chat;
