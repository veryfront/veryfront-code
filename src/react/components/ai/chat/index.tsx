/**
 * Chat Component - Layer 3 (Styled)
 *
 * Production-ready, fully styled chat component.
 * Built on Layer 2 primitives.
 *
 * @module ai/react/components/chat
 */

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

// Re-export components
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

// Re-export utilities
export {
  getTextContent,
  groupPartsInOrder,
  isReasoningPart,
  isToolPart,
  type PartGroup,
} from "./utils/message-parts.ts";

// Re-export composition API
export { ChatFooter, ChatHeader, ChatInput, ChatMessages } from "./composition/api.tsx";

// Import for internal use
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
import { ChatFooter, ChatHeader, ChatInput, ChatMessages } from "./composition/api.tsx";

export interface ChatProps {
  /** Messages to display (AI SDK v5 format) */
  messages: UIMessage[];

  /** Current input value */
  input: string;

  /** Input change handler (alternative naming) */
  onChange?: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;

  /** Input change handler (from useChat) */
  handleInputChange?: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;

  /** Submit handler (alternative naming) */
  onSubmit?: (e: React.FormEvent) => void | Promise<void>;

  /** Submit handler (from useChat) */
  handleSubmit?: (e: React.FormEvent) => void | Promise<void>;

  /** Stop handler - called when stop button is clicked during loading */
  stop?: () => void;

  /** Reload handler - called to retry the last message (from useChat) */
  reload?: () => void;

  /** Enable built-in voice input (uses Web Speech API) */
  enableVoice?: boolean;

  /** Custom voice input handler - overrides built-in voice if provided */
  onVoice?: () => void;

  /** Setter for input value (required for voice input to work) */
  setInput?: (value: string) => void;

  /** Loading state */
  isLoading?: boolean;

  /** Error state */
  error?: Error | null;

  /** Placeholder text */
  placeholder?: string;

  /** Max height */
  maxHeight?: string;

  /** Additional class name */
  className?: string;

  /** Theme customization */
  theme?: Partial<ChatTheme>;

  /** Custom message renderer */
  renderMessage?: (message: UIMessage) => React.ReactNode;

  /** Custom tool renderer (v5 format) */
  renderTool?: (tool: ToolUIPart | DynamicToolUIPart) => React.ReactNode;

  /** Enable multiline input */
  multiline?: boolean;

  /** Suggestions to show when no messages exist */
  suggestions?: string[];

  /** Handler for suggestion clicks */
  onSuggestionClick?: (suggestion: string) => void;

  /** Empty state configuration */
  emptyState?: {
    icon?: React.ReactNode;
    title?: string;
    description?: string;
  };

  /** Show scroll-to-bottom button */
  showScrollButton?: boolean;

  /** Show message actions (copy button) on assistant messages */
  showMessageActions?: boolean;
}

/**
 * Chat - Complete chat interface
 *
 * Production-ready chat component with sensible defaults.
 *
 * @example
 * ```tsx
 * import { Chat } from 'veryfront/components/ai';
 * import { useChat } from 'veryfront/agent/react';
 *
 * export default function ChatPage() {
 *   const chat = useChat({ api: '/api/chat' });
 *   return <Chat {...chat} />;
 * }
 * ```
 */
export const Chat = React.forwardRef<HTMLDivElement, ChatProps>(
  (
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
  ) => {
    const theme = mergeThemes(defaultChatTheme, userTheme);
    const messagesEndRef = React.useRef<HTMLDivElement>(null);

    // Support both naming conventions from useChat
    const inputChangeHandler = onChange || handleInputChange || (() => {});
    const submitHandler = onSubmit || handleSubmit;

    // Built-in voice input
    const voice = useVoiceInput({
      onTranscript: (transcript, isFinal) => {
        if (setInput && isFinal) {
          setInput(transcript);
        }
      },
    });

    // Determine voice handler - custom or built-in
    const voiceHandler = React.useMemo(() => {
      if (onVoice) return onVoice;
      if (enableVoice && voice.isSupported && setInput) {
        return voice.toggle;
      }
      return undefined;
    }, [onVoice, enableVoice, voice.isSupported, voice.toggle, setInput]);

    // Auto-scroll to bottom on new messages
    React.useEffect(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    return (
      <ChatContainer
        ref={ref}
        className={cn(theme.container, className)}
        style={{ maxHeight }}
      >
        {/* Message List - scrollable content area */}
        <MessageList className="flex-1 min-h-0 overflow-y-auto relative">
          {/* Empty state - centered vertically like ChatGPT */}
          {messages.length === 0
            ? (
              <div className="flex flex-col items-center justify-center h-full px-4">
                <div className="flex-1" />
                <ConversationEmptyState
                  icon={emptyState?.icon || <MessageSquareIcon className="size-10" />}
                  title={emptyState?.title || "What can I help with?"}
                  description={emptyState?.description}
                />
                {/* Suggestions grid - ChatGPT style */}
                {suggestions && suggestions.length > 0 && (
                  <div className="w-full max-w-2xl mt-6 mb-8">
                    <Suggestions layout="grid">
                      {suggestions.map((suggestion) => (
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
                  // For user messages, use simple text extraction
                  if (msg.role === "user") {
                    const content = getTextContent(msg);
                    return renderMessage
                      ? <React.Fragment key={msg.id}>{renderMessage(msg)}</React.Fragment>
                      : (
                        <MessageItem
                          key={msg.id}
                          role={msg.role}
                          className={cn("flex", "justify-end")}
                        >
                          <div className={theme.message?.[msg.role] || theme.message?.user}>
                            <p className="whitespace-pre-wrap text-[15px] leading-relaxed">
                              {content}
                            </p>
                          </div>
                        </MessageItem>
                      );
                  }

                  // For assistant messages, render parts in order
                  const partGroups = groupPartsInOrder(msg.parts);
                  const textContent = getTextContent(msg);
                  return renderMessage
                    ? <React.Fragment key={msg.id}>{renderMessage(msg)}</React.Fragment>
                    : (
                      <MessageItem
                        key={msg.id}
                        role={msg.role}
                        className={cn("flex", "justify-start")}
                      >
                        <div className={theme.message?.[msg.role] || theme.message?.assistant}>
                          {partGroups.map((group, index) => {
                            if (group.type === "text") {
                              return (
                                <Markdown
                                  key={`text-${index}`}
                                  className="text-[15px] leading-relaxed"
                                >
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
                            // Tool part
                            return (
                              <div key={group.tool.toolCallId} className="my-3">
                                {renderTool
                                  ? renderTool(group.tool)
                                  : <ToolCallCard tool={group.tool} />}
                              </div>
                            );
                          })}
                          {/* Message actions for assistant messages */}
                          {showMessageActions && textContent && (
                            <MessageActions content={textContent} />
                          )}
                        </div>
                      </MessageItem>
                    );
                })}

                {/* Loading indicator */}
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

                {/* Auto-scroll anchor */}
                <div ref={messagesEndRef} />
              </div>
            )}

          {/* Scroll to bottom button */}
          {showScrollButton && (
            <ConversationScrollButton
              onClick={() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })}
            />
          )}
        </MessageList>

        {/* Error display with retry button */}
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

        {/* Input area - fixed at bottom */}
        <div className="flex-shrink-0 bg-white dark:bg-neutral-900 border-t border-neutral-200 dark:border-neutral-800">
          <form
            onSubmit={submitHandler}
            className="max-w-2xl mx-auto px-4 py-3"
          >
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
  },
);

Chat.displayName = "Chat";

// Attach subcomponents for composition API
export const ChatComponents = Object.assign(Chat, {
  Header: ChatHeader,
  Messages: ChatMessages,
  Input: ChatInput,
  Footer: ChatFooter,
});
