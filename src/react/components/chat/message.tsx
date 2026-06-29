import * as React from "react";
import { MessageContent, MessageItem, MessageRole } from "../../primitives/index.ts";
import type { ChatMessage, ChatMessagePart, ChatToolPart } from "#veryfront/agent/react";
import { type ChatTheme, cn, defaultChatTheme, mergeThemes } from "./theme.ts";

/** Props accepted by message. */
export interface MessageProps {
  /** Message to display */
  message: ChatMessage;

  /** Additional class name */
  className?: string;

  /** Theme customization */
  theme?: Partial<ChatTheme>;

  /** Show role label */
  showRole?: boolean;

  /** Show timestamp */
  showTimestamp?: boolean;

  /** Custom renderer for tool calls (matches tool-${toolName} pattern) */
  renderToolCall?: (part: ChatToolPart) => React.ReactNode;

  /** Custom renderer for dynamic tools */
  renderDynamicTool?: (
    part: Extract<ChatMessagePart, { type: "dynamic-tool" }>,
  ) => React.ReactNode;

  /** Custom renderer for reasoning */
  renderReasoning?: (
    part: Extract<ChatMessagePart, { type: "reasoning" }>,
  ) => React.ReactNode;
}

function getTextFromParts(parts: ChatMessagePart[]): string {
  return parts
    .filter((p): p is Extract<ChatMessagePart, { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join("");
}

function isToolPart(part: ChatMessagePart): part is ChatToolPart {
  return part.type.startsWith("tool-") && "toolCallId" in part;
}
/** Render a standalone chat message. */
export const Message = React.forwardRef<HTMLDivElement, MessageProps>(
  function Message(
    {
      message,
      className,
      theme: userTheme,
      showRole = false,
      showTimestamp = false,
      renderToolCall,
      renderDynamicTool,
      renderReasoning,
    },
    ref,
  ) {
    const theme = mergeThemes(defaultChatTheme, userTheme);
    const messageTheme = theme.message?.[message.role] ??
      theme.message?.assistant;

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
        <div className={messageTheme}>
          {showRole && (
            <MessageRole className="mb-1 block text-xs font-medium text-[var(--faint)]">
              {message.role}
            </MessageRole>
          )}

          {message.parts.map((part, index) => {
            const key = `${message.id}-part-${index}`;

            if (part.type === "text") {
              return <MessageContent key={key}>{part.text}</MessageContent>;
            }

            if (part.type === "reasoning") {
              if (renderReasoning) {
                return (
                  <React.Fragment key={key}>
                    {renderReasoning(part)}
                  </React.Fragment>
                );
              }

              return (
                <div
                  key={key}
                  className="my-2 text-sm text-[var(--faint)]"
                >
                  {part.text}
                </div>
              );
            }

            if (part.type === "dynamic-tool") {
              if (renderDynamicTool) {
                return (
                  <React.Fragment key={key}>
                    {renderDynamicTool(part)}
                  </React.Fragment>
                );
              }

              return (
                <div
                  key={key}
                  className="my-2 rounded-[var(--radius-md)] border border-[var(--outline-border)] bg-transparent p-4 text-sm"
                >
                  <span className="font-mono">{part.toolName}</span>
                  <span className="ml-2 text-[var(--faint)]">
                    [dynamic: {part.state}]
                  </span>
                  {part.errorText && (
                    <div className="mt-1 text-[var(--destructive)]">
                      {part.errorText}
                    </div>
                  )}
                </div>
              );
            }

            if (!isToolPart(part)) return null;

            if (renderToolCall) {
              return (
                <React.Fragment key={key}>
                  {renderToolCall(part)}
                </React.Fragment>
              );
            }

            return (
              <div
                key={key}
                className="my-2 rounded-[var(--radius-md)] border border-[var(--outline-border)] bg-transparent p-4 text-sm"
              >
                <span className="font-mono">{part.toolName}</span>
                <span className="ml-2 text-[var(--faint)]">
                  [{part.state}]
                </span>
                {part.errorText && (
                  <div className="mt-1 text-[var(--destructive)]">
                    {part.errorText}
                  </div>
                )}
              </div>
            );
          })}

          {showTimestamp && message.createdAt && (
            <div className="text-xs opacity-60 mt-1">
              {new Date(message.createdAt).toLocaleTimeString()}
            </div>
          )}
        </div>
      </MessageItem>
    );
  },
);

Message.displayName = "Message";

/** Props accepted by streaming message. */
export interface StreamingMessageProps {
  /** Streaming message parts */
  parts: ChatMessagePart[];

  /** Show typing cursor */
  showCursor?: boolean;

  /** Additional class name */
  className?: string;

  /** Theme customization */
  theme?: Partial<ChatTheme>;
}

/** Message shape for streaming. */
export const StreamingMessage = React.forwardRef<
  HTMLDivElement,
  StreamingMessageProps
>(
  function StreamingMessage(
    { parts, showCursor = true, className, theme: userTheme },
    ref,
  ) {
    const theme = mergeThemes(defaultChatTheme, userTheme);
    const textContent = getTextFromParts(parts);

    return (
      <MessageItem
        ref={ref}
        role="assistant"
        className={cn("flex justify-start", className)}
      >
        <div className={theme.message?.assistant}>
          <MessageContent>
            {textContent}
            {showCursor && <span className="inline-block w-1 h-4 bg-current ml-1 animate-pulse" />}
          </MessageContent>
        </div>
      </MessageItem>
    );
  },
);

StreamingMessage.displayName = "StreamingMessage";
