import * as React from "react";
import {
  ChatContainer,
  InputBox,
  MessageItem,
  MessageList,
  SubmitButton,
} from "../../../primitives/index.ts";
import { useVoiceInput } from "#veryfront/agent/react";
import type {
  BranchInfo,
  BrowserInferenceStatus,
  DynamicToolUIPart,
  InferenceMode,
  ToolUIPart,
  UIMessage,
} from "#veryfront/agent/react";
import { type ChatTheme, cn, defaultChatTheme, mergeThemes } from "../theme.ts";
import { Markdown } from "../markdown.tsx";
import { MessageSquareIcon, PaperclipIcon, RefreshCwIcon, SparklesIcon } from "../icons/index.ts";
import { type ModelOption, ModelSelector } from "../model-selector.tsx";
import { DropZoneOverlay } from "./components/drop-zone.tsx";

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
export { Sources, type Source, type SourcesProps } from "./components/sources.tsx";
export { InlineCitation, type InlineCitationProps } from "./components/inline-citation.tsx";
export { MessageFeedback, type FeedbackValue, type MessageFeedbackProps } from "./components/message-feedback.tsx";
export { AttachmentPill, type AttachmentInfo, type AttachmentPillProps } from "./components/attachment-pill.tsx";
export { RichCodeBlock, type CodeBlockProps } from "./components/code-block.tsx";
export { StepIndicator, type StepIndicatorProps } from "./components/step-indicator.tsx";
export { ChatSidebar, type ChatSidebarProps } from "./components/sidebar.tsx";
export {
  useThreads,
  type Thread,
  type UseThreadsOptions,
  type UseThreadsResult,
} from "./hooks/use-threads.ts";

export {
  extractSourcesFromParts,
  getTextContent,
  groupPartsInOrder,
  isReasoningPart,
  isToolPart,
  type PartGroup,
} from "./utils/message-parts.ts";
export { downloadMarkdown, exportAsMarkdown } from "./utils/export.ts";

export { ChatFooter, ChatHeader, ChatInput, ChatMessages } from "./composition/api.tsx";

import { ChatFooter, ChatHeader, ChatInput, ChatMessages } from "./composition/api.tsx";
import {
  ConversationEmptyState,
  ConversationScrollButton,
  Suggestion,
  Suggestions,
} from "./components/empty-state.tsx";
import { MessageActions } from "./components/message-actions.tsx";
import { ReasoningCard } from "./components/reasoning.tsx";
import { ToolCallCard } from "./components/tool-ui.tsx";
import { InferenceBadge } from "./components/inference-badge.tsx";
import { UpgradeCTA } from "./components/upgrade-cta.tsx";
import { Sources } from "./components/sources.tsx";
import type { Source } from "./components/sources.tsx";
import { extractSourcesFromParts, getTextContent, groupPartsInOrder } from "./utils/message-parts.ts";
import { MessageEditForm } from "./components/message-edit-form.tsx";
import { BranchPicker } from "./components/branch-picker.tsx";
import { MessageFeedback } from "./components/message-feedback.tsx";
import type { FeedbackValue } from "./components/message-feedback.tsx";
import { StepIndicator } from "./components/step-indicator.tsx";
import { AttachmentPill } from "./components/attachment-pill.tsx";
import type { AttachmentInfo } from "./components/attachment-pill.tsx";
import { downloadMarkdown } from "./utils/export.ts";

export interface ChatProps {
  messages: UIMessage[];
  input: string;
  onChange?: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  handleInputChange?: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  onSubmit?: (e: React.FormEvent) => void | Promise<void>;
  handleSubmit?: (e: React.FormEvent) => void | Promise<void>;
  stop?: () => void;
  reload?: () => void;
  enableVoice?: boolean;
  onVoice?: () => void;
  setInput?: (value: string) => void;
  isLoading?: boolean;
  error?: Error | null;
  placeholder?: string;
  maxHeight?: string;
  className?: string;
  theme?: Partial<ChatTheme>;
  renderMessage?: (message: UIMessage) => React.ReactNode;
  renderTool?: (tool: ToolUIPart | DynamicToolUIPart) => React.ReactNode;
  multiline?: boolean;
  suggestions?: string[];
  onSuggestionClick?: (suggestion: string) => void;
  emptyState?: {
    icon?: React.ReactNode;
    title?: string;
    description?: string;
  };
  showScrollButton?: boolean;
  showMessageActions?: boolean;
  /** Available models for runtime switching */
  models?: ModelOption[];
  /** Currently selected model */
  model?: string;
  /** Called when user changes model */
  onModelChange?: (model: string) => void;
  /** Alias for onModelChange (matches useChat's setModel) */
  setModel?: (model: string | undefined) => void;
  /** Where inference is currently happening */
  inferenceMode?: InferenceMode;
  /** Browser-side model loading/inference status */
  browserStatus?: BrowserInferenceStatus | null;
  /** Show source documents extracted from tool results */
  showSources?: boolean;
  /** Called when user clicks a source */
  onSourceClick?: (source: Source, index: number) => void;
  /** Called when user attaches files — renders a paperclip button in the input area */
  onAttach?: (files: FileList) => void;
  /** Called when user drops files on the chat area (defaults to onAttach) */
  onDrop?: (files: FileList) => void;
  /** Accepted file types for attachment (e.g. ".pdf,.docx,.txt") */
  attachAccept?: string;
  /** Currently attached files shown as pills above the input */
  attachments?: AttachmentInfo[];
  /** Called when user removes an attachment */
  onRemoveAttachment?: (id: string) => void;
  /** Show export/download button for conversation */
  showExport?: boolean;
  /** Called when user gives feedback on a message */
  onFeedback?: (messageId: string, feedback: FeedbackValue) => void;
  /** Edit a user message and resubmit (from useChat) */
  editMessage?: (messageId: string, newText: string) => Promise<void>;
  /** Get branch info for a message (from useChat) */
  getBranches?: (messageId: string) => BranchInfo;
  /** Switch to a different branch at a message (from useChat) */
  switchBranch?: (messageId: string, branchIndex: number) => void;
  /** Show step indicators for multi-step agent reasoning */
  showSteps?: boolean;
}

export const Chat = React.forwardRef<HTMLDivElement, ChatProps>(function Chat(
  {
    messages,
    input,
    onChange,
    handleInputChange,
    onSubmit,
    handleSubmit,
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
    multiline = false,
    suggestions,
    onSuggestionClick,
    emptyState,
    showScrollButton = false,
    showMessageActions = true,
    models,
    model,
    onModelChange,
    setModel,
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
  },
  ref,
): React.ReactElement {
  const theme = mergeThemes(defaultChatTheme, userTheme);
  const messagesEndRef = React.useRef<HTMLDivElement>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  // --- Feedback state ---
  const [feedbackMap, setFeedbackMap] = React.useState<Record<string, FeedbackValue>>({});
  const handleFeedback = React.useCallback((msgId: string, value: FeedbackValue) => {
    setFeedbackMap((prev) => ({ ...prev, [msgId]: value }));
    onFeedback?.(msgId, value);
  }, [onFeedback]);

  const inputChangeHandler = onChange ?? handleInputChange ?? (() => {});
  const submitHandler = onSubmit ?? handleSubmit;
  const modelChangeHandler = onModelChange ?? (setModel as ((model: string) => void) | undefined);

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

  const handleFileDrop = React.useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current = 0;
    setDragOver(false);
    if (e.dataTransfer.files.length > 0 && dropHandler) {
      dropHandler(e.dataTransfer.files);
    }
  }, [dropHandler]);

  // --- Message editing ---
  const [editingMessageId, setEditingMessageId] = React.useState<string | null>(null);

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

  // Auto-scroll to bottom only when a new message is added (not on every
  // streaming delta). This prevents the view from jumping to the bottom
  // while the user is scrolled up reading earlier messages.
  const messageCount = messages.length;
  React.useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messageCount]);

  const isEmpty = messages.length === 0;
  const showSuggestions = (suggestions?.length ?? 0) > 0;

  const dragProps = dropHandler
    ? {
      onDragEnter: handleDragEnter,
      onDragLeave: handleDragLeave,
      onDragOver: handleDragOver,
      onDrop: handleFileDrop,
    }
    : {};

  return (
    <ChatContainer ref={ref} className={cn(theme.container, "relative", className)} style={{ maxHeight }} {...dragProps}>
      {dropHandler && <DropZoneOverlay visible={dragOver} accept={attachAccept} />}
      <MessageList className="flex-1 min-h-0 overflow-y-auto relative">
        {isEmpty
          ? (
            <div className="flex flex-col items-center justify-center h-full px-4">
              <div className="flex-1" />
              <ConversationEmptyState
                icon={emptyState?.icon ?? <MessageSquareIcon className="size-10" />}
                title={emptyState?.title ?? "What can I help with?"}
                description={emptyState?.description}
              />
              {showSuggestions && (
                <div className="w-full max-w-2xl mt-6 mb-8">
                  <Suggestions layout="grid">
                    {suggestions?.map((suggestion) => (
                      <Suggestion
                        key={suggestion}
                        suggestion={suggestion}
                        onClick={onSuggestionClick}
                      />
                    ))}
                  </Suggestions>
                </div>
              )}
              {inferenceMode && inferenceMode !== "cloud" && (
                <UpgradeCTA inferenceMode={inferenceMode} />
              )}
              <div className="flex-1" />
            </div>
          )
          : (
            <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
              {messages.map((msg) => {
                if (renderMessage) {
                  return <React.Fragment key={msg.id}>{renderMessage(msg)}</React.Fragment>;
                }

                if (msg.role === "user") {
                  const content = getTextContent(msg);
                  const isEditing = editingMessageId === msg.id;
                  const branches = getBranches?.(msg.id);
                  const hasBranches = branches && branches.total > 1;

                  return (
                    <MessageItem key={msg.id} role={msg.role} className={cn("flex flex-col items-end", "group/msg")}>
                      {isEditing
                        ? (
                          <div className="w-full max-w-md">
                            <MessageEditForm
                              initialContent={content}
                              onSave={(text) => {
                                setEditingMessageId(null);
                                editMessage?.(msg.id, text);
                              }}
                              onCancel={() => setEditingMessageId(null)}
                            />
                          </div>
                        )
                        : (
                          <div className={theme.message?.[msg.role] ?? theme.message?.user}>
                            <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{content}</p>
                          </div>
                        )}
                      {!isEditing && (
                        <div className="flex items-center gap-2 mt-1">
                          {hasBranches && (
                            <BranchPicker
                              current={branches.current}
                              total={branches.total}
                              onPrev={() => switchBranch?.(msg.id, branches.current - 2)}
                              onNext={() => switchBranch?.(msg.id, branches.current)}
                            />
                          )}
                          {editMessage && (
                            <MessageActions
                              content={content}
                              onEdit={() => setEditingMessageId(msg.id)}
                            />
                          )}
                        </div>
                      )}
                    </MessageItem>
                  );
                }

                const partGroups = groupPartsInOrder(msg.parts);
                const textContent = getTextContent(msg);
                const messageSources = showSources ? extractSourcesFromParts(msg.parts) : [];

                return (
                  <MessageItem key={msg.id} role={msg.role} className={cn("flex items-start gap-3", "justify-start", "group/msg")}>
                    <div className="mt-1 shrink-0 size-8 rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center shadow-sm">
                      <SparklesIcon className="size-4 text-white" />
                    </div>
                    <div className={cn(theme.message?.[msg.role] ?? theme.message?.assistant, "flex-1 min-w-0")}>
                      {partGroups.map((group, index) => {
                        if (group.type === "text") {
                          return (
                            <Markdown key={`text-${index}`} className="text-[15px] leading-7">
                              {group.content}
                            </Markdown>
                          );
                        }

                        if (group.type === "reasoning") {
                          return (
                            <ReasoningCard
                              key={`reasoning-${index}`}
                              text={group.text}
                              isStreaming={group.isStreaming}
                            />
                          );
                        }

                        if (group.type === "step") {
                          return showSteps
                            ? <StepIndicator key={`step-${group.stepIndex}`} stepIndex={group.stepIndex} isComplete={group.isComplete} />
                            : null;
                        }

                        return (
                          <div key={group.tool.toolCallId} className="my-3">
                            {renderTool
                              ? renderTool(group.tool)
                              : <ToolCallCard tool={group.tool} />}
                          </div>
                        );
                      })}

                      {(showMessageActions || onFeedback) && textContent && (
                        <div className="flex items-center gap-1 mt-1">
                          {showMessageActions && <MessageActions content={textContent} />}
                          {onFeedback && (
                            <MessageFeedback
                              messageId={msg.id}
                              feedback={feedbackMap[msg.id]}
                              onFeedback={handleFeedback}
                            />
                          )}
                        </div>
                      )}

                      {messageSources.length > 0 && (
                        <Sources sources={messageSources} onSourceClick={onSourceClick} />
                      )}
                    </div>
                  </MessageItem>
                );
              })}

              {isLoading && (
                <div className="flex items-start gap-3">
                  <div className="mt-1 shrink-0 size-8 rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center shadow-sm">
                    <SparklesIcon className="size-4 text-white" />
                  </div>
                  {browserStatus === "downloading-model" || browserStatus === "loading-runtime"
                    ? (
                      <div className="flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400 py-2.5">
                        <span className="size-1.5 rounded-full bg-amber-500 animate-pulse" />
                        <span>
                          {browserStatus === "downloading-model"
                            ? "Downloading model..."
                            : "Loading AI..."}
                        </span>
                      </div>
                    )
                    : (
                      <div className="flex gap-1.5 items-center py-3">
                        <span className={cn(theme.loading)} />
                        <span className={cn(theme.loading)} style={{ animationDelay: "0.15s" }} />
                        <span className={cn(theme.loading)} style={{ animationDelay: "0.3s" }} />
                      </div>
                    )}
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          )}

        {showScrollButton && (
          <ConversationScrollButton
            onClick={() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })}
          />
        )}
      </MessageList>

      {error && (
        <div className="max-w-2xl mx-auto px-4 pb-2">
          <div className="px-4 py-3 bg-red-50 dark:bg-red-900/20 rounded-2xl text-red-600 dark:text-red-400 text-sm flex items-center justify-between gap-3 border border-red-100 dark:border-red-900/30">
            <span>{error.message}</span>
            {reload && (
              <button
                type="button"
                onClick={reload}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-600 dark:text-red-400 bg-red-100 dark:bg-red-900/40 hover:bg-red-200 dark:hover:bg-red-900/60 rounded-full transition-colors"
              >
                <RefreshCwIcon className="size-3" />
                Retry
              </button>
            )}
          </div>
        </div>
      )}

      <div className="flex-shrink-0 bg-white dark:bg-neutral-950 pb-3 pt-2">
        {inferenceMode && inferenceMode !== "cloud" && (
          <div className="max-w-2xl mx-auto">
            <InferenceBadge inferenceMode={inferenceMode} browserStatus={browserStatus} />
          </div>
        )}
        <form onSubmit={submitHandler} className="max-w-2xl mx-auto px-4">
          {models && models.length > 0 && modelChangeHandler && (
            <div className="mb-2">
              <ModelSelector
                models={models}
                value={model}
                onChange={modelChangeHandler}
                disabled={isLoading}
              />
            </div>
          )}
          <div className="rounded-2xl border border-neutral-200/80 dark:border-neutral-700/80 bg-white dark:bg-neutral-900 focus-within:border-neutral-300 dark:focus-within:border-neutral-600 focus-within:shadow-md transition-all shadow-sm">
            {attachments && attachments.length > 0 && (
              <div className="flex flex-wrap gap-1.5 px-3 pt-2.5">
                {attachments.map((file) => (
                  <AttachmentPill key={file.id} attachment={file} onRemove={onRemoveAttachment} />
                ))}
              </div>
            )}
            <div className="flex items-end gap-2 px-3 py-2">
              {onAttach && (
                <>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept={attachAccept}
                    multiple
                    onChange={(e) => {
                      if (e.target.files?.length) onAttach(e.target.files);
                      e.target.value = "";
                    }}
                    style={{ position: "absolute", width: 1, height: 1, padding: 0, margin: -1, overflow: "hidden", clip: "rect(0,0,0,0)", whiteSpace: "nowrap", border: 0 }}
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="size-8 flex items-center justify-center rounded-full text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 hover:bg-neutral-200/60 dark:hover:bg-neutral-700/60 transition-colors shrink-0"
                    aria-label="Attach file"
                  >
                    <PaperclipIcon className="size-[18px]" />
                  </button>
                </>
              )}
              <InputBox
                value={voice.isListening ? voice.transcript || input : input}
                onChange={inputChangeHandler}
                placeholder={voice.isListening ? "Listening..." : placeholder}
                disabled={isLoading || voice.isListening}
                multiline
                className={theme.input}
                rows={1}
              />
              {showExport && messages.length > 0 && (
                <button
                  type="button"
                  onClick={() => downloadMarkdown(messages)}
                  className="size-8 flex items-center justify-center rounded-full text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 hover:bg-neutral-200/60 dark:hover:bg-neutral-700/60 transition-colors shrink-0"
                  aria-label="Export conversation"
                  title="Export as Markdown"
                >
                  <svg className="size-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                </button>
              )}
              <SubmitButton
                isLoading={isLoading || voice.isListening}
                hasInput={!!input.trim()}
                onStop={voice.isListening ? voice.stop : stop}
                onVoice={voiceHandler}
                disabled={!input.trim()}
                className={theme.button}
              />
            </div>
          </div>
        </form>
      </div>
    </ChatContainer>
  );
});

Chat.displayName = "Chat";

export const ChatComponents = Object.assign(Chat, {
  Header: ChatHeader,
  Messages: ChatMessages,
  Input: ChatInput,
  Footer: ChatFooter,
});
