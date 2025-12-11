/**
 * Message Component - Layer 3 (Styled)
 *
 * Production-ready message display with AI SDK v5 parts support.
 */

import * as React from "react";
import { MessageContent, MessageItem, MessageRole } from "../primitives/index.ts";
import type { UIMessage, UIMessagePart } from "../hooks/index.ts";
import { type ChatTheme, cn, defaultChatTheme, mergeThemes } from "./theme.ts";

export interface MessageProps {
  /** Message to display (v5 UIMessage format) */
  message: UIMessage;

  /** Additional class name */
  className?: string;

  /** Theme customization */
  theme?: Partial<ChatTheme>;

  /** Show role label */
  showRole?: boolean;

  /** Show timestamp */
  showTimestamp?: boolean;

  /** Custom renderer for tool calls */
  renderToolCall?: (part: Extract<UIMessagePart, { type: "tool-call" }>) => React.ReactNode;

  /** Custom renderer for dynamic tools */
  renderDynamicTool?: (
    part: Extract<UIMessagePart, { type: "dynamic-tool" }>,
  ) => React.ReactNode;

  /** Custom renderer for reasoning */
  renderReasoning?: (part: Extract<UIMessagePart, { type: "reasoning" }>) => React.ReactNode;
}

/**
 * Helper to extract text content from v5 parts array
 */
function getTextFromParts(parts: UIMessagePart[]): string {
  return parts
    .filter((p): p is Extract<UIMessagePart, { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join("");
}

/**
 * Message - Styled message component with v5 parts support
 *
 * @example
 * ```tsx
 * import { Message } from 'veryfront/ai/components';
 *
 * <Message
 *   message={msg}
 *   showRole={true}
 *   renderToolCall={(part) => <MyToolUI part={part} />}
 * />
 * ```
 */
export const Message = React.forwardRef<HTMLDivElement, MessageProps>(
  (
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

          {/* Render parts array (v5 format) */}
          {message.parts.map((part, index) => {
            const key = `${message.id}-part-${index}`;

            switch (part.type) {
              case "text":
                return (
                  <MessageContent key={key}>
                    {part.text}
                  </MessageContent>
                );

              case "reasoning":
                if (renderReasoning) {
                  return <React.Fragment key={key}>{renderReasoning(part)}</React.Fragment>;
                }
                return (
                  <div key={key} className="text-sm italic opacity-70 my-2 pl-2 border-l-2">
                    {part.text}
                  </div>
                );

              case "tool-call":
                if (renderToolCall) {
                  return <React.Fragment key={key}>{renderToolCall(part)}</React.Fragment>;
                }
                return (
                  <div key={key} className="text-xs bg-gray-100 rounded p-2 my-2">
                    <span className="font-mono">{part.toolName}</span>
                    <span className="ml-2 text-gray-500">[{part.state}]</span>
                    {part.errorText && (
                      <div className="text-red-600 mt-1">{part.errorText}</div>
                    )}
                  </div>
                );

              case "dynamic-tool":
                if (renderDynamicTool) {
                  return <React.Fragment key={key}>{renderDynamicTool(part)}</React.Fragment>;
                }
                return (
                  <div key={key} className="text-xs bg-blue-50 rounded p-2 my-2">
                    <span className="font-mono">{part.toolName}</span>
                    <span className="ml-2 text-blue-500">[dynamic: {part.state}]</span>
                    {part.errorText && (
                      <div className="text-red-600 mt-1">{part.errorText}</div>
                    )}
                  </div>
                );

              default:
                return null;
            }
          })}

          {showTimestamp && (
            <div className="text-xs opacity-60 mt-1">
              {new Date().toLocaleTimeString()}
            </div>
          )}
        </div>
      </MessageItem>
    );
  },
);

Message.displayName = "Message";

export interface StreamingMessageProps {
  /** Streaming parts (v5 format) */
  parts: UIMessagePart[];

  /** Show typing cursor */
  showCursor?: boolean;

  /** Additional class name */
  className?: string;

  /** Theme customization */
  theme?: Partial<ChatTheme>;
}

/**
 * StreamingMessage - Display streaming message with v5 parts
 *
 * @example
 * ```tsx
 * import { StreamingMessage } from 'veryfront/ai/components';
 *
 * {isStreaming && (
 *   <StreamingMessage parts={streamingParts} showCursor={true} />
 * )}
 * ```
 */
export const StreamingMessage = React.forwardRef<
  HTMLDivElement,
  StreamingMessageProps
>(({ parts, showCursor = true, className, theme: userTheme }, ref) => {
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
});

StreamingMessage.displayName = "StreamingMessage";
