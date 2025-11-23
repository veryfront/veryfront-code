/**
 * ChatContainer Primitive - Layer 2 (Unstyled)
 *
 * Root container for chat interfaces.
 * Built on Radix UI patterns (shadcn-compatible).
 */

import * as React from "react";

export interface ChatContainerProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

/**
 * ChatContainer - Root chat component
 *
 * Provides minimal structure. Bring your own styles.
 *
 * @example
 * ```tsx
 * <ChatContainer className="flex flex-col h-screen">
 *   <YourHeader />
 *   <MessageList messages={messages} />
 *   <YourInput />
 * </ChatContainer>
 * ```
 */
export const ChatContainer = React.forwardRef<HTMLDivElement, ChatContainerProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={className}
        data-chat-container=""
        {...props}
      >
        {children}
      </div>
    );
  },
);

ChatContainer.displayName = "ChatContainer";
