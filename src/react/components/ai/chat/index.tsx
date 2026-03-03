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
  BrowserInferenceStatus,
  DynamicToolUIPart,
  InferenceMode,
  ToolUIPart,
  UIMessage,
} from "#veryfront/agent/react";
import { type ChatTheme, cn, defaultChatTheme, mergeThemes } from "../theme.ts";
import { Markdown } from "../markdown.tsx";
import { MessageSquareIcon, PaperclipIcon, RefreshCwIcon } from "../icons/index.ts";
import { type ModelOption, ModelSelector } from "../model-selector.tsx";

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
export { ToolCallCard, ToolStatusBadge } from "./components/tool-ui.tsx";
export { InferenceBadge, type InferenceBadgeProps } from "./components/inference-badge.tsx";
export { UpgradeCTA, type UpgradeCTAProps } from "./components/upgrade-cta.tsx";
export { Sources, type Source, type SourcesProps } from "./components/sources.tsx";
export { InlineCitation, type InlineCitationProps } from "./components/inline-citation.tsx";

export {
  extractSourcesFromParts,
  getTextContent,
  groupPartsInOrder,
  isReasoningPart,
  isToolPart,
  type PartGroup,
} from "./utils/message-parts.ts";

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
  /** Accepted file types for attachment (e.g. ".pdf,.docx,.txt") */
  attachAccept?: string;
  /** Currently attached files shown as pills above the input */
  attachments?: Array<{ id: string; name: string; status?: "uploading" | "ready" }>;
  /** Called when user removes an attachment */
  onRemoveAttachment?: (id: string) => void;
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
    inferenceMode,
    browserStatus,
    showSources = false,
    onSourceClick,
    onAttach,
    attachAccept,
    attachments,
    onRemoveAttachment,
  },
  ref,
): React.ReactElement {
  const theme = mergeThemes(defaultChatTheme, userTheme);
  const messagesEndRef = React.useRef<HTMLDivElement>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const inputChangeHandler = onChange ?? handleInputChange ?? (() => {});
  const submitHandler = onSubmit ?? handleSubmit;

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

  return (
    <ChatContainer ref={ref} className={cn(theme.container, className)} style={{ maxHeight }}>
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
            <div className="max-w-2xl mx-auto px-4 py-8 space-y-8">
              {messages.map((msg) => {
                if (renderMessage) {
                  return <React.Fragment key={msg.id}>{renderMessage(msg)}</React.Fragment>;
                }

                if (msg.role === "user") {
                  const content = getTextContent(msg);

                  return (
                    <MessageItem key={msg.id} role={msg.role} className={cn("flex", "justify-end")}>
                      <div className={theme.message?.[msg.role] ?? theme.message?.user}>
                        <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{content}</p>
                      </div>
                    </MessageItem>
                  );
                }

                const partGroups = groupPartsInOrder(msg.parts);
                const textContent = getTextContent(msg);
                const messageSources = showSources ? extractSourcesFromParts(msg.parts) : [];

                return (
                  <MessageItem key={msg.id} role={msg.role} className={cn("flex", "justify-start", "group/msg")}>
                    <div className={theme.message?.[msg.role] ?? theme.message?.assistant}>
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

                        return (
                          <div key={group.tool.toolCallId} className="my-3">
                            {renderTool
                              ? renderTool(group.tool)
                              : <ToolCallCard tool={group.tool} />}
                          </div>
                        );
                      })}

                      {showMessageActions && textContent && (
                        <MessageActions content={textContent} />
                      )}

                      {messageSources.length > 0 && (
                        <Sources sources={messageSources} onSourceClick={onSourceClick} />
                      )}
                    </div>
                  </MessageItem>
                );
              })}

              {isLoading && (
                <div className="flex justify-start">
                  {browserStatus === "downloading-model" || browserStatus === "loading-runtime"
                    ? (
                      <div className="flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
                        <span className="size-1.5 rounded-full bg-amber-500 animate-pulse" />
                        <span>
                          {browserStatus === "downloading-model"
                            ? "Downloading model..."
                            : "Loading AI..."}
                        </span>
                      </div>
                    )
                    : (
                      <div className="flex gap-1 items-center py-2">
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
          <div className="px-4 py-3 bg-red-50 dark:bg-red-900/20 rounded-[20px] text-red-600 dark:text-red-400 text-sm flex items-center justify-between gap-3">
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

      <div className="flex-shrink-0 bg-white dark:bg-neutral-950 pb-6">
        {inferenceMode && inferenceMode !== "cloud" && (
          <div className="max-w-2xl mx-auto">
            <InferenceBadge inferenceMode={inferenceMode} browserStatus={browserStatus} />
          </div>
        )}
        <form onSubmit={submitHandler} className="max-w-2xl mx-auto px-4">
          {models && models.length > 0 && onModelChange && (
            <div className="mb-2">
              <ModelSelector
                models={models}
                value={model}
                onChange={onModelChange}
                disabled={isLoading}
              />
            </div>
          )}
          <div className="rounded-2xl border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900 focus-within:border-neutral-400 dark:focus-within:border-neutral-500 transition-colors shadow-sm">
            {attachments && attachments.length > 0 && (
              <div className="flex flex-wrap gap-1.5 px-3 pt-2.5">
                {attachments.map((file) => (
                  <span
                    key={file.id}
                    className="inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 rounded-lg bg-neutral-200/60 dark:bg-neutral-700/60 text-xs text-neutral-700 dark:text-neutral-300"
                  >
                    <svg className="size-3 shrink-0 text-neutral-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                    </svg>
                    <span className="truncate max-w-[120px]">{file.name}</span>
                    {file.status === "uploading"
                      ? (
                        <span className="size-3 shrink-0 rounded-full border-2 border-neutral-400 border-t-transparent animate-spin" />
                      )
                      : onRemoveAttachment && (
                        <button
                          type="button"
                          onClick={() => onRemoveAttachment(file.id)}
                          className="size-4 shrink-0 flex items-center justify-center rounded-full hover:bg-neutral-300 dark:hover:bg-neutral-600 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200 transition-colors"
                        >
                          <svg className="size-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
                          </svg>
                        </button>
                      )}
                  </span>
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
