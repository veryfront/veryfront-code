import * as React from "react";
export const ChatContainer = React.forwardRef(function ChatContainer({ className, children, ...props }, ref) {
    return (React.createElement("div", { ref: ref, className: className, "data-chat-container": "", ...props }, children));
});
ChatContainer.displayName = "ChatContainer";
