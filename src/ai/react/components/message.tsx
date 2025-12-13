
import * as React from "react";
import { MessageContent, MessageItem, MessageRole } from "../primitives/index.ts";
import type { Message as MessageType } from "../../types/agent.ts";
import { type ChatTheme, cn, defaultChatTheme, mergeThemes } from "./theme.ts";

export interface MessageProps {
  message: MessageType;

  className?: string;

  theme?: Partial<ChatTheme>;

  showRole?: boolean;

  showTimestamp?: boolean;
}

export const Message = React.forwardRef<HTMLDivElement, MessageProps>(
  (
    { message, className, theme: userTheme, showRole = false, showTimestamp = false },
    ref,
  ) => {
    const theme = mergeThemes(defaultChatTheme, userTheme);

    return (
      <MessageItem
        ref={ref}
        role={message.role}
        className={cn(
          "flex",
          message.role === "user" ? "justify-end" : "justify-start",
          className,
        )}
      >
        <div className={theme.message?.[message.role] || theme.message?.assistant}>
          {showRole && (
            <MessageRole className="block text-xs font-semibold mb-1 opacity-75 uppercase">
              {message.role}
            </MessageRole>
          )}

          <MessageContent>{message.content}</MessageContent>

          {showTimestamp && message.timestamp && (
            <div className="text-xs opacity-60 mt-1">
              {new Date(message.timestamp).toLocaleTimeString()}
            </div>
          )}
        </div>
      </MessageItem>
    );
  },
);

Message.displayName = "Message";

export interface StreamingMessageProps {
  content: string;

  showCursor?: boolean;

  className?: string;

  theme?: Partial<ChatTheme>;
}

export const StreamingMessage = React.forwardRef<
  HTMLDivElement,
  StreamingMessageProps
>(({ content, showCursor = true, className, theme: userTheme }, ref) => {
  const theme = mergeThemes(defaultChatTheme, userTheme);

  return (
    <MessageItem
      ref={ref}
      role="assistant"
      className={cn("flex justify-start", className)}
    >
      <div className={theme.message?.assistant}>
        <MessageContent>
          {content}
          {showCursor && <span className="inline-block w-1 h-4 bg-current ml-1 animate-pulse" />}
        </MessageContent>
      </div>
    </MessageItem>
  );
});

StreamingMessage.displayName = "StreamingMessage";
