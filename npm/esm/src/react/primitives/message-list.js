import * as React from "react";
export const MessageList = React.forwardRef(function MessageList({ className, children, ...props }, ref) {
    return (React.createElement("div", { ref: ref, className: className, "data-message-list": "", role: "log", "aria-live": "polite", ...props }, children));
});
MessageList.displayName = "MessageList";
export const MessageItem = React.forwardRef(function MessageItem({ className, role, content, children, ...props }, ref) {
    return (React.createElement("div", { ref: ref, className: className, "data-message-item": "", "data-role": role, ...props }, children ?? content));
});
MessageItem.displayName = "MessageItem";
export const MessageRole = React.forwardRef(function MessageRole({ className, children, ...props }, ref) {
    return (React.createElement("span", { ref: ref, className: className, "data-message-role": "", ...props }, children));
});
MessageRole.displayName = "MessageRole";
export const MessageContent = React.forwardRef(function MessageContent({ className, children, ...props }, ref) {
    return (React.createElement("div", { ref: ref, className: className, "data-message-content": "", ...props }, children));
});
MessageContent.displayName = "MessageContent";
