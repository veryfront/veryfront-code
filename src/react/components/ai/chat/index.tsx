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
 * <Chat.Root messages={messages} input={input}>
 *   <Chat.Empty title="Ask anything" />
 *   <Chat.MessageList messages={messages} />
 *   <Chat.Composer input={input} onChange={onChange} />
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
 * @module ai/react/components/chat
 */

import * as React from "react";
import { useVoiceInput } from "#veryfront/agent/react";
import type {
  BranchInfo,
  BrowserInferenceStatus,
  DynamicToolUIPart,
  InferenceMode,
  ToolUIPart,
  UIMessage,
} from "#veryfront/agent/react";
import { type ChatTheme, defaultChatTheme, mergeThemes } from "../theme.ts";
import type { ModelOption } from "../model-selector.tsx";
import type { Source } from "./components/sources.tsx";
import type { AttachmentInfo } from "./components/attachment-pill.tsx";
import type { FeedbackValue } from "./components/message-feedback.tsx";
import type { ChatTab } from "./components/tab-switcher.tsx";
import type { UploadedFile } from "./components/uploads-panel.tsx";
import type { QuickAction } from "./components/quick-actions.tsx";

// Composition imports (used in the Chat preset)
import { ChatRoot } from "./composition/chat-root.tsx";
import { ChatComposer } from "./composition/chat-composer.tsx";
import { ChatMessageList } from "./composition/chat-message-list.tsx";
import { ChatEmpty } from "./composition/chat-empty.tsx";
import { ChatIf } from "./composition/chat-if.tsx";
import { ErrorBanner } from "./composition/error-banner.tsx";
import { Message } from "./composition/message.tsx";
import { DropZoneOverlay } from "./components/drop-zone.tsx";
import { TabSwitcher } from "./components/tab-switcher.tsx";
import { UploadsPanel } from "./components/uploads-panel.tsx";
import { InferenceBadge } from "./components/inference-badge.tsx";
import { UpgradeCTA } from "./components/upgrade-cta.tsx";
import { QuickActions as QuickActionsComponent } from "./components/quick-actions.tsx";

// ---------------------------------------------------------------------------
// Re-exports — sub-components
// ---------------------------------------------------------------------------

export { FadeIn, Loader, Shimmer } from "./components/animations.tsx";
export { ReasoningCard } from "./components/reasoning.tsx";
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
export { MessageActions, type MessageActionsProps } from "./components/message-actions.tsx";
export { MessageEditForm, type MessageEditFormProps } from "./components/message-edit-form.tsx";
export { BranchPicker, type BranchPickerProps } from "./components/branch-picker.tsx";
export { DropZoneOverlay, type DropZoneOverlayProps } from "./components/drop-zone.tsx";
export { ToolCallCard, ToolStatusBadge } from "./components/tool-ui.tsx";
export { InferenceBadge, type InferenceBadgeProps } from "./components/inference-badge.tsx";
export { UpgradeCTA, type UpgradeCTAProps } from "./components/upgrade-cta.tsx";
export { type Source, Sources, type SourcesProps } from "./components/sources.tsx";
export { InlineCitation, type InlineCitationProps } from "./components/inline-citation.tsx";
export {
  type FeedbackValue,
  MessageFeedback,
  type MessageFeedbackProps,
} from "./components/message-feedback.tsx";
export {
  type AttachmentInfo,
  AttachmentPill,
  type AttachmentPillProps,
} from "./components/attachment-pill.tsx";
export { type CodeBlockProps, RichCodeBlock } from "./components/code-block.tsx";
export { StepIndicator, type StepIndicatorProps } from "./components/step-indicator.tsx";
export { ChatSidebar, type ChatSidebarProps } from "./components/sidebar.tsx";
export { type ChatTab, TabSwitcher, type TabSwitcherProps } from "./components/tab-switcher.tsx";
export {
  type QuickAction,
  QuickActions,
  type QuickActionsProps,
} from "./components/quick-actions.tsx";
export {
  type UploadedFile,
  UploadsPanel,
  type UploadsPanelProps,
} from "./components/uploads-panel.tsx";

// Re-exports — hooks
export {
  type Thread,
  useThreads,
  type UseThreadsOptions,
  type UseThreadsResult,
} from "./hooks/use-threads.ts";

// Re-exports — utils
export {
  extractSourcesFromParts,
  getTextContent,
  groupPartsInOrder,
  isReasoningPart,
  isToolPart,
  type PartGroup,
} from "./utils/message-parts.ts";
export { downloadMarkdown, exportAsMarkdown } from "./utils/export.ts";

// Re-exports — composition
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

export interface ChatProps {
  messages: UIMessage[];
  input: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  onSubmit?: (e?: React.FormEvent) => void | Promise<void>;
  stop?: () => void;
  reload?: () => void;
  setInput?: (value: string) => void;
  isLoading?: boolean;
  error?: Error | null;
  placeholder?: string;
  maxHeight?: string;
  className?: string;
  theme?: Partial<ChatTheme>;
  renderMessage?: (message: UIMessage) => React.ReactNode;
  renderTool?: (tool: ToolUIPart | DynamicToolUIPart) => React.ReactNode;
  suggestions?: string[];
  onSuggestionClick?: (suggestion: string) => void;
  emptyState?: {
    icon?: React.ReactNode;
    title?: string;
    description?: string;
  };
  showScrollButton?: boolean;
  showMessageActions?: boolean;
  models?: ModelOption[];
  model?: string;
  /** The actual resolved model after auto-upgrade (used for avatar display) */
  activeModel?: string;
  onModelChange?: (model: string) => void;
  inferenceMode?: InferenceMode;
  browserStatus?: BrowserInferenceStatus | null;
  showSources?: boolean;
  onSourceClick?: (source: Source, index: number) => void;
  onAttach?: (files: FileList) => void;
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
  /** @internal Hide the built-in TabSwitcher when rendered externally */
  hideTabSwitcher?: boolean;
  children?: React.ReactNode;
}

// ---------------------------------------------------------------------------
// Chat — Preset component
//
// Composes ChatRoot, ChatMessageList, ChatComposer, ChatEmpty, etc. into a
// full-featured chat UI with sensible defaults. For custom layouts, use the
// building blocks directly.
// ---------------------------------------------------------------------------

export const Chat = React.forwardRef<HTMLDivElement, ChatProps>(function Chat(
  {
    messages,
    input,
    onChange,
    onSubmit,
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
    showScrollButton = false,
    showMessageActions = true,
    models,
    model,
    activeModel,
    onModelChange,
    inferenceMode,
    browserStatus,
    showSources = false,
    onSourceClick,
    onAttach,
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
    hideTabSwitcher = false,
    children,
  },
  ref,
): React.ReactElement {
  const theme = React.useMemo(() => mergeThemes(defaultChatTheme, userTheme), [userTheme]);

  // --- Drag-and-drop ---
  const dropHandler = onDrop ?? onAttach;
  const [dragOver, setDragOver] = React.useState(false);
  const dragCounter = React.useRef(0);

  const handleDragEnter = React.useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current++;
    if (e.dataTransfer.types.includes("Files")) setDragOver(true);
  }, []);

  const handleDragLeave = React.useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current === 0) setDragOver(false);
  }, []);

  const handleDragOver = React.useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleFileDrop = React.useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounter.current = 0;
      setDragOver(false);
      if (e.dataTransfer.files.length > 0 && dropHandler) {
        dropHandler(e.dataTransfer.files);
      }
    },
    [dropHandler],
  );

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
  const isDocsTab = showTabs && currentTab === "uploads";

  const dragProps = dropHandler
    ? {
      onDragEnter: handleDragEnter,
      onDragLeave: handleDragLeave,
      onDragOver: handleDragOver,
      onDrop: handleFileDrop,
    }
    : {};

  return (
    <ChatRoot
      ref={ref}
      messages={messages}
      input={input}
      isLoading={isLoading}
      error={error}
      setInput={setInput}
      onSubmit={onSubmit}
      onStop={stop}
      onReload={reload}
      model={model}
      models={models}
      onModelChange={onModelChange}
      attachments={attachments}
      onAttach={onAttach}
      onRemoveAttachment={onRemoveAttachment}
      editMessage={editMessage}
      getBranches={getBranches}
      switchBranch={switchBranch}
      onFeedback={onFeedback}
      showSources={showSources}
      onSourceClick={onSourceClick}
      theme={userTheme}
      maxHeight={maxHeight}
      className={className}
      {...dragProps}
    >
      {dropHandler && <DropZoneOverlay visible={dragOver} accept={attachAccept} />}

      {showTabs && !hideTabSwitcher && (
        <TabSwitcher activeTab={currentTab} onTabChange={handleTabChange} />
      )}

      {isDocsTab
        ? (
          <UploadsPanel
            uploads={uploads}
            onRemoveUpload={onRemoveUpload}
            onAttach={onAttach}
            attachAccept={attachAccept}
            className="flex-1 min-h-0"
          />
        )
        : isEmpty
        ? (
          <ChatEmpty
            icon={emptyState?.icon}
            title={emptyState?.title}
            description={emptyState?.description}
            suggestions={suggestions}
            onSuggestionClick={onSuggestionClick}
          >
            {inferenceMode && inferenceMode !== "cloud" && (
              <UpgradeCTA inferenceMode={inferenceMode} />
            )}
          </ChatEmpty>
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
            browserStatus={browserStatus}
            editMessage={editMessage}
            getBranches={getBranches}
            switchBranch={switchBranch}
            onFeedback={onFeedback}
          />
        )}

      {error && <ErrorBanner error={error} onRetry={reload} />}

      {!isDocsTab && (
        <ChatComposer
          input={voice.isListening ? voice.transcript || input : input}
          onChange={onChange}
          onSubmit={onSubmit}
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
          onAttach={onAttach}
          attachAccept={attachAccept}
          attachments={attachments}
          onRemoveAttachment={onRemoveAttachment}
          showExport={showExport}
          messages={messages}
        >
          {inferenceMode && inferenceMode !== "cloud" && (
            <InferenceBadge inferenceMode={inferenceMode} browserStatus={browserStatus} />
          )}
          {isEmpty && quickActions && quickActions.length > 0 && (
            <QuickActionsComponent actions={quickActions} onActionClick={onQuickAction} />
          )}
        </ChatComposer>
      )}

      {children}
    </ChatRoot>
  );
});
Chat.displayName = "Chat";

// ---------------------------------------------------------------------------
// ChatComponents — Compound API via Object.assign
// ---------------------------------------------------------------------------

export const ChatComponents = Object.assign(Chat, {
  Root: ChatRoot,
  MessageList: ChatMessageList,
  Composer: ChatComposer,
  Empty: ChatEmpty,
  If: ChatIf,
  Message: Message,
  ErrorBanner: ErrorBanner,
});
