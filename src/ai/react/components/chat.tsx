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
        <MessageList className="flex-1 overflow-y-auto p-4 space-y-4">
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
                    {msg.content}
                  </div>
                </MessageItem>
              )
          )}

          {/* Loading indicator */}
          {isLoading && (
            <div className="flex justify-start">
              <div className="bg-gray-200 dark:bg-gray-800 rounded-lg px-4 py-2">
                <LoadingIndicator className={theme.loading} />
              </div>
            </div>
          )}

          {/* Auto-scroll anchor */}
          <div ref={messagesEndRef} />
        </MessageList>

        {/* Error display */}
        {error && (
          <div className="px-4 py-2 bg-red-50 dark:bg-red-900/20 border-l-4 border-red-500 text-red-900 dark:text-red-100">
            <p className="text-sm font-medium">Error</p>
            <p className="text-sm">{error.message}</p>
          </div>
        )}

        {/* Input area */}
        <form
          onSubmit={submitHandler}
          className="border-t border-gray-200 dark:border-gray-800 p-4"
        >
          <div className="flex gap-2">
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
              Send
            </SubmitButton>
          </div>
        </form>
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
