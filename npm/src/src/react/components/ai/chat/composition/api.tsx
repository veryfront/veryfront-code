/**
 * Chat Composition API
 * @module ai/react/components/chat/composition/api
 */

import * as React from "react";
import { InputBox, MessageList } from "../../../../primitives/index.js";
import { cn, defaultChatTheme } from "../../theme.js";

export const ChatHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(function ChatHeader({ className, children, ...props }, ref) {
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

export const ChatMessages = MessageList;
ChatMessages.displayName = "ChatMessages";

export const ChatInput = React.forwardRef<
  HTMLInputElement | HTMLTextAreaElement,
  React.ComponentProps<typeof InputBox>
>(function ChatInput({ className, ...props }, ref) {
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

export const ChatFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(function ChatFooter({ className, children, ...props }, ref) {
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
