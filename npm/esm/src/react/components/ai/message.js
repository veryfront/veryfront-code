import * as React from "react";
import { MessageContent, MessageItem, MessageRole } from "../../primitives/index.js";
import { cn, defaultChatTheme, mergeThemes } from "./theme.js";
function getTextFromParts(parts) {
    return parts
        .filter((p) => p.type === "text")
        .map((p) => p.text)
        .join("");
}
function isToolPart(part) {
    return part.type.startsWith("tool-") && "toolCallId" in part;
}
export const Message = React.forwardRef(({ message, className, theme: userTheme, showRole = false, showTimestamp = false, renderToolCall, renderDynamicTool, renderReasoning, }, ref) => {
    const theme = mergeThemes(defaultChatTheme, userTheme);
    const messageTheme = theme.message?.[message.role] ?? theme.message?.assistant;
    return (React.createElement(MessageItem, { ref: ref, role: message.role, className: cn("flex", message.role === "user" ? "justify-end" : "justify-start", className) },
        React.createElement("div", { className: messageTheme },
            showRole && (React.createElement(MessageRole, { className: "block text-xs font-semibold mb-1 opacity-75 uppercase" }, message.role)),
            message.parts.map((part, index) => {
                const key = `${message.id}-part-${index}`;
                if (part.type === "text") {
                    return React.createElement(MessageContent, { key: key }, part.text);
                }
                if (part.type === "reasoning") {
                    if (renderReasoning) {
                        return React.createElement(React.Fragment, { key: key }, renderReasoning(part));
                    }
                    return (React.createElement("div", { key: key, className: "text-sm italic opacity-70 my-2 pl-2 border-l-2" }, part.text));
                }
                if (part.type === "dynamic-tool") {
                    if (renderDynamicTool) {
                        return React.createElement(React.Fragment, { key: key }, renderDynamicTool(part));
                    }
                    return (React.createElement("div", { key: key, className: "text-xs bg-blue-50 rounded p-2 my-2" },
                        React.createElement("span", { className: "font-mono" }, part.toolName),
                        React.createElement("span", { className: "ml-2 text-blue-500" },
                            "[dynamic: ",
                            part.state,
                            "]"),
                        part.errorText && React.createElement("div", { className: "text-red-600 mt-1" }, part.errorText)));
                }
                if (isToolPart(part)) {
                    if (renderToolCall) {
                        return React.createElement(React.Fragment, { key: key }, renderToolCall(part));
                    }
                    return (React.createElement("div", { key: key, className: "text-xs bg-gray-100 rounded p-2 my-2" },
                        React.createElement("span", { className: "font-mono" }, part.toolName),
                        React.createElement("span", { className: "ml-2 text-gray-500" },
                            "[",
                            part.state,
                            "]"),
                        part.errorText && React.createElement("div", { className: "text-red-600 mt-1" }, part.errorText)));
                }
                return null;
            }),
            showTimestamp && message.createdAt && (React.createElement("div", { className: "text-xs opacity-60 mt-1" }, new Date(message.createdAt).toLocaleTimeString())))));
});
Message.displayName = "Message";
export const StreamingMessage = React.forwardRef(({ parts, showCursor = true, className, theme: userTheme }, ref) => {
    const theme = mergeThemes(defaultChatTheme, userTheme);
    const textContent = getTextFromParts(parts);
    return (React.createElement(MessageItem, { ref: ref, role: "assistant", className: cn("flex justify-start", className) },
        React.createElement("div", { className: theme.message?.assistant },
            React.createElement(MessageContent, null,
                textContent,
                showCursor && React.createElement("span", { className: "inline-block w-1 h-4 bg-current ml-1 animate-pulse" })))));
});
StreamingMessage.displayName = "StreamingMessage";
