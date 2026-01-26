import * as React from "react";

export interface ChatContainerProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

export const ChatContainer = React.forwardRef<HTMLDivElement, ChatContainerProps>(
  function ChatContainer({ className, children, ...props }, ref): React.ReactElement {
    return (
      <div ref={ref} className={className} data-chat-container="" {...props}>
        {children}
      </div>
    );
  },
);

ChatContainer.displayName = "ChatContainer";
