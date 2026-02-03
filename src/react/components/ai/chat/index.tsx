import * as React from "react";
import {
  ChatContainer,
  InputBox,
  MessageItem,
  MessageList,
  SubmitButton,
} from "../../../primitives/index.ts";
import { useVoiceInput } from "#veryfront/agent/react";
import type { DynamicToolUIPart, ToolUIPart, UIMessage } from "#veryfront/agent/react";
import { type ChatTheme, cn, defaultChatTheme, mergeThemes } from "../theme.ts";
import { Markdown } from "../markdown.tsx";
import { MessageSquareIcon, RefreshCwIcon } from "../icons/index.ts";

export { Loader, Shimmer } from "./components/animations.tsx";
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

export {
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
import { getTextContent, groupPartsInOrder } from "./utils/message-parts.ts";

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
  },
  ref,
): React.ReactElement {
  const theme = mergeThemes(defaultChatTheme, userTheme);
  const messagesEndRef = React.useRef<HTMLDivElement>(null);

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

  React.useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

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
              <div className="flex-1" />
            </div>
          )
          : (
            <div className="max-w-2xl mx-auto px-4 py-4 space-y-2">
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

                return (
                  <MessageItem key={msg.id} role={msg.role} className={cn("flex", "justify-start")}>
                    <div className={theme.message?.[msg.role] ?? theme.message?.assistant}>
                      {partGroups.map((group, index) => {
                        if (group.type === "text") {
                          return (
                            <Markdown key={`text-${index}`} className="text-[15px] leading-relaxed">
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
                    </div>
                  </MessageItem>
                );
              })}

              {isLoading && (
                <div className="flex justify-start">
                  <div className="bg-neutral-100 dark:bg-neutral-800 rounded-[20px] rounded-bl-[4px] px-4 py-3">
                    <div className="flex gap-1.5 items-center">
                      <span className={cn(theme.loading)} />
                      <span className={cn(theme.loading)} style={{ animationDelay: "0.15s" }} />
                      <span className={cn(theme.loading)} style={{ animationDelay: "0.3s" }} />
                    </div>
                  </div>
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
        <div className="mx-4 mb-2 px-4 py-3 bg-red-50 dark:bg-red-900/20 rounded-2xl text-red-600 dark:text-red-400 text-sm flex items-center justify-between gap-3">
          <span>{error.message}</span>
          {reload && (
            <button
              type="button"
              onClick={reload}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-600 dark:text-red-400 bg-red-100 dark:bg-red-900/40 hover:bg-red-200 dark:hover:bg-red-900/60 rounded-lg transition-colors"
            >
              <RefreshCwIcon className="size-3.5" />
              Retry
            </button>
          )}
        </div>
      )}

      <div className="flex-shrink-0 bg-white dark:bg-neutral-900 border-t border-neutral-200 dark:border-neutral-800">
        <form onSubmit={submitHandler} className="max-w-2xl mx-auto px-4 py-3">
          <div className="flex gap-2 items-center">
            <InputBox
              value={voice.isListening ? voice.transcript || input : input}
              onChange={inputChangeHandler}
              placeholder={voice.isListening ? "Listening..." : placeholder}
              disabled={isLoading || voice.isListening}
              multiline={multiline}
              className={theme.input}
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
