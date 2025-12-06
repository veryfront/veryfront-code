/**
 * Chat Component - Layer 3 (Styled)
 *
 * Production-ready, fully styled chat component.
 * Built on Layer 2 primitives.
 */

import * as React from "react";
import {
  ChatContainer,
  InputBox,
  LoadingIndicator,
  MessageItem,
  MessageList,
  SubmitButton,
} from "../primitives/index.ts";
import type { Message, ToolCall } from "../../types/agent.ts";
import { type ChatTheme, cn, defaultChatTheme, mergeThemes } from "./theme.ts";

export interface ChatProps {
  /** Messages to display */
  messages: Message[];

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
  renderMessage?: (message: Message) => React.ReactNode;

  /** Custom tool renderer */
  renderTool?: (toolCall: ToolCall) => React.ReactNode;

  /** Enable multiline input */
  multiline?: boolean;
}

/**
 * Chat - Complete chat interface
 *
 * Production-ready chat component with sensible defaults.
 *
 * @example
 * ```tsx
 * import { Chat } from 'veryfront/ai/components';
 * import { useChat } from 'veryfront/ai/react';
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
      isLoading,
      error,
      placeholder = "Type a message...",
      maxHeight = "100%",
      className,
      theme: userTheme,
      renderMessage,
      renderTool: _renderTool,
      multiline = false,
    },
    ref,
  ) => {
    const theme = mergeThemes(defaultChatTheme, userTheme);
    const messagesEndRef = React.useRef<HTMLDivElement>(null);

    // Support both naming conventions from useChat
    const inputChangeHandler = onChange || handleInputChange || (() => {});
    const submitHandler = onSubmit || handleSubmit;

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
        {/* Message List */}
        <MessageList className="flex-1 overflow-y-auto">
          <div className="max-w-2xl mx-auto px-4 py-4 space-y-2">
            {messages.map((msg) =>
              renderMessage
                ? <React.Fragment key={msg.id}>{renderMessage(msg)}</React.Fragment>
                : (
                  <MessageItem
                    key={msg.id}
                    role={msg.role}
                    className={cn(
                      "flex",
                      msg.role === "user" ? "justify-end" : "justify-start",
                    )}
                  >
                    <div className={theme.message?.[msg.role] || theme.message?.assistant}>
                      <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{msg.content}</p>
                    </div>
                  </MessageItem>
                )
            )}

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
        </MessageList>

        {/* Error display */}
        {error && (
          <div className="mx-4 mb-2 px-4 py-3 bg-red-50 dark:bg-red-900/20 rounded-2xl text-red-600 dark:text-red-400 text-sm">
            {error.message}
          </div>
        )}

        {/* Input area - Apple style */}
        <div className="bg-white dark:bg-neutral-900 border-t border-neutral-200 dark:border-neutral-800">
          <form
            onSubmit={submitHandler}
            className="max-w-2xl mx-auto px-4 py-3"
          >
            <div className="flex gap-2 items-center">
              <InputBox
                value={input}
                onChange={inputChangeHandler}
                placeholder={placeholder}
                disabled={isLoading}
                multiline={multiline}
                className={theme.input}
              />
              <SubmitButton
                isLoading={isLoading}
                disabled={!input.trim() || isLoading}
                className={theme.button}
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
                </svg>
              </SubmitButton>
            </div>
          </form>
        </div>
      </ChatContainer>
    );
  },
);

Chat.displayName = "Chat";

// Composition API (for advanced usage)
const ChatHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, children, ...props }, ref) => {
  return (
    <div
      ref={ref}
      className={cn(
        "border-b border-gray-200 dark:border-gray-800 p-4 bg-gray-50 dark:bg-gray-900",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
});
ChatHeader.displayName = "ChatHeader";

const ChatMessages = MessageList;
ChatMessages.displayName = "ChatMessages";

const ChatInput = React.forwardRef<
  HTMLInputElement | HTMLTextAreaElement,
  React.ComponentProps<typeof InputBox>
>(({ className, ...props }, ref) => {
  return (
    <div className="border-t border-gray-200 dark:border-gray-800 p-4">
      <div className="flex gap-2">
        <InputBox
          ref={ref}
          className={cn(defaultChatTheme.input, className)}
          {...props}
        />
      </div>
    </div>
  );
});
ChatInput.displayName = "ChatInput";

const ChatFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, children, ...props }, ref) => {
  return (
    <div
      ref={ref}
      className={cn(
        "border-t border-gray-200 dark:border-gray-800 p-4 text-sm text-gray-500",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
});
ChatFooter.displayName = "ChatFooter";

// Attach subcomponents for composition API
export const ChatComponents = Object.assign(Chat, {
  Header: ChatHeader,
  Messages: ChatMessages,
  Input: ChatInput,
  Footer: ChatFooter,
});
