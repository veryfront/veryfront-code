import * as React from "react";
import type { UIMessage } from "../../agent/react/index.js";

export interface MessageListProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

export const MessageList = React.forwardRef<HTMLDivElement, MessageListProps>(
  function MessageList({ className, children, ...props }, ref) {
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
  role: UIMessage["role"];
  /** Message content (can be children or prop) - deprecated, use children with parts */
  content?: string;
  children?: React.ReactNode;
}

export const MessageItem = React.forwardRef<HTMLDivElement, MessageItemProps>(
  function MessageItem({ className, role, content, children, ...props }, ref) {
    return (
      <div
        ref={ref}
        className={className}
        data-message-item=""
        data-role={role}
        {...props}
      >
        {children ?? content}
      </div>
    );
  },
);

MessageItem.displayName = "MessageItem";

export interface MessageRoleProps extends React.HTMLAttributes<HTMLSpanElement> {
  children: React.ReactNode;
}

export const MessageRole = React.forwardRef<HTMLSpanElement, MessageRoleProps>(
  function MessageRole({ className, children, ...props }, ref) {
    return (
      <span ref={ref} className={className} data-message-role="" {...props}>
        {children}
      </span>
    );
  },
);

MessageRole.displayName = "MessageRole";

export interface MessageContentProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

export const MessageContent = React.forwardRef<
  HTMLDivElement,
  MessageContentProps
>(function MessageContent({ className, children, ...props }, ref) {
  return (
    <div ref={ref} className={className} data-message-content="" {...props}>
      {children}
    </div>
  );
});

MessageContent.displayName = "MessageContent";
