/**
 * MessageList & MessageItem Primitives - Layer 2 (Unstyled)
 *
 * Message rendering primitives.
 * Built on Radix UI patterns (shadcn-compatible).
 */

import * as React from "react";
import type { UIMessage } from "@veryfront/agent/react";

export interface MessageListProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

/**
 * MessageList - Container for messages
 *
 * @example
 * ```tsx
 * <MessageList className="flex-1 overflow-y-auto space-y-4">
 *   {messages.map((msg) => (
 *     <MessageItem key={msg.id} role={msg.role}>
 *       {msg.content}
 *     </MessageItem>
 *   ))}
 * </MessageList>
 * ```
 */
export const MessageList = React.forwardRef<HTMLDivElement, MessageListProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={className}
        data-message-list=""
        role="log"
        aria-live="polite"
        {...props}
      >
        {children}
      </div>
    );
  },
);

MessageList.displayName = "MessageList";

export interface MessageItemProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Message role */
  role: UIMessage["role"];

  /** Message content (can be children or prop) - deprecated, use children with parts */
  content?: string;

  children?: React.ReactNode;
}

/**
 * MessageItem - Individual message
 *
 * @example
 * ```tsx
 * <MessageItem role="user" className="flex justify-end">
 *   <div className="bg-blue-500 text-white rounded-lg px-4 py-2">
 *     {message.content}
 *   </div>
 * </MessageItem>
 * ```
 */
export const MessageItem = React.forwardRef<HTMLDivElement, MessageItemProps>(
  ({ className, role, content, children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={className}
        data-message-item=""
        data-role={role}
        {...props}
      >
        {children || content}
      </div>
    );
  },
);

MessageItem.displayName = "MessageItem";

export interface MessageRoleProps extends React.HTMLAttributes<HTMLSpanElement> {
  children: React.ReactNode;
}

/**
 * MessageRole - Role indicator
 *
 * @example
 * ```tsx
 * <MessageRole className="font-semibold text-sm">
 *   {message.role}
 * </MessageRole>
 * ```
 */
export const MessageRole = React.forwardRef<HTMLSpanElement, MessageRoleProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <span
        ref={ref}
        className={className}
        data-message-role=""
        {...props}
      >
        {children}
      </span>
    );
  },
);

MessageRole.displayName = "MessageRole";

export interface MessageContentProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

/**
 * MessageContent - Message content wrapper
 *
 * @example
 * ```tsx
 * <MessageContent className="prose">
 *   {message.content}
 * </MessageContent>
 * ```
 */
export const MessageContent = React.forwardRef<
  HTMLDivElement,
  MessageContentProps
>(({ className, children, ...props }, ref) => {
  return (
    <div
      ref={ref}
      className={className}
      data-message-content=""
      {...props}
    >
      {children}
    </div>
  );
});

MessageContent.displayName = "MessageContent";
