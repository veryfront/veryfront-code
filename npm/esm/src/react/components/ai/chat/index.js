import * as React from "react";
import { ChatContainer, InputBox, MessageItem, MessageList, SubmitButton, } from "../../../primitives/index.js";
import { useVoiceInput } from "../../../../agent/react/index.js";
import { cn, defaultChatTheme, mergeThemes } from "../theme.js";
import { Markdown } from "../markdown.js";
import { MessageSquareIcon, RefreshCwIcon } from "../icons/index.js";
export { Loader, Shimmer } from "./components/animations.js";
export { ReasoningCard } from "./components/reasoning.js";
export { ConversationEmptyState, ConversationScrollButton, Suggestion, Suggestions, } from "./components/empty-state.js";
export { MessageActions } from "./components/message-actions.js";
export { ToolCallCard, ToolStatusBadge } from "./components/tool-ui.js";
export { getTextContent, groupPartsInOrder, isReasoningPart, isToolPart, } from "./utils/message-parts.js";
export { ChatFooter, ChatHeader, ChatInput, ChatMessages } from "./composition/api.js";
import { ConversationEmptyState, ConversationScrollButton, Suggestion, Suggestions, } from "./components/empty-state.js";
import { MessageActions } from "./components/message-actions.js";
import { ReasoningCard } from "./components/reasoning.js";
import { ToolCallCard } from "./components/tool-ui.js";
import { getTextContent, groupPartsInOrder } from "./utils/message-parts.js";
import { ChatFooter, ChatHeader, ChatInput, ChatMessages } from "./composition/api.js";
export const Chat = React.forwardRef(function Chat({ messages, input, onChange, handleInputChange, onSubmit, handleSubmit, stop, reload, enableVoice = false, onVoice, setInput, isLoading, error, placeholder = "Type a message...", maxHeight = "100%", className, theme: userTheme, renderMessage, renderTool, multiline = false, suggestions, onSuggestionClick, emptyState, showScrollButton = false, showMessageActions = true, }, ref) {
    const theme = mergeThemes(defaultChatTheme, userTheme);
    const messagesEndRef = React.useRef(null);
    const inputChangeHandler = onChange ?? handleInputChange ?? (() => { });
    const submitHandler = onSubmit ?? handleSubmit;
    const voice = useVoiceInput({
        onTranscript: (transcript, isFinal) => {
            if (!isFinal || !setInput)
                return;
            setInput(transcript);
        },
    });
    const voiceHandler = React.useMemo(() => {
        if (onVoice)
            return onVoice;
        if (enableVoice && voice.isSupported && setInput)
            return voice.toggle;
        return undefined;
    }, [onVoice, enableVoice, voice.isSupported, voice.toggle, setInput]);
    React.useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);
    const isEmpty = messages.length === 0;
    const showSuggestions = (suggestions?.length ?? 0) > 0;
    return (React.createElement(ChatContainer, { ref: ref, className: cn(theme.container, className), style: { maxHeight } },
        React.createElement(MessageList, { className: "flex-1 min-h-0 overflow-y-auto relative" },
            isEmpty
                ? (React.createElement("div", { className: "flex flex-col items-center justify-center h-full px-4" },
                    React.createElement("div", { className: "flex-1" }),
                    React.createElement(ConversationEmptyState, { icon: emptyState?.icon ?? React.createElement(MessageSquareIcon, { className: "size-10" }), title: emptyState?.title ?? "What can I help with?", description: emptyState?.description }),
                    showSuggestions && (React.createElement("div", { className: "w-full max-w-2xl mt-6 mb-8" },
                        React.createElement(Suggestions, { layout: "grid" }, suggestions.map((suggestion) => (React.createElement(Suggestion, { key: suggestion, suggestion: suggestion, onClick: onSuggestionClick })))))),
                    React.createElement("div", { className: "flex-1" })))
                : (React.createElement("div", { className: "max-w-2xl mx-auto px-4 py-4 space-y-2" },
                    messages.map((msg) => {
                        if (renderMessage) {
                            return React.createElement(React.Fragment, { key: msg.id }, renderMessage(msg));
                        }
                        if (msg.role === "user") {
                            const content = getTextContent(msg);
                            return (React.createElement(MessageItem, { key: msg.id, role: msg.role, className: cn("flex", "justify-end") },
                                React.createElement("div", { className: theme.message?.[msg.role] ?? theme.message?.user },
                                    React.createElement("p", { className: "whitespace-pre-wrap text-[15px] leading-relaxed" }, content))));
                        }
                        const partGroups = groupPartsInOrder(msg.parts);
                        const textContent = getTextContent(msg);
                        return (React.createElement(MessageItem, { key: msg.id, role: msg.role, className: cn("flex", "justify-start") },
                            React.createElement("div", { className: theme.message?.[msg.role] ?? theme.message?.assistant },
                                partGroups.map((group, index) => {
                                    if (group.type === "text") {
                                        return (React.createElement(Markdown, { key: `text-${index}`, className: "text-[15px] leading-relaxed" }, group.content));
                                    }
                                    if (group.type === "reasoning") {
                                        return (React.createElement(ReasoningCard, { key: `reasoning-${index}`, text: group.text, isStreaming: group.isStreaming }));
                                    }
                                    return (React.createElement("div", { key: group.tool.toolCallId, className: "my-3" }, renderTool
                                        ? renderTool(group.tool)
                                        : React.createElement(ToolCallCard, { tool: group.tool })));
                                }),
                                showMessageActions && textContent && (React.createElement(MessageActions, { content: textContent })))));
                    }),
                    isLoading && (React.createElement("div", { className: "flex justify-start" },
                        React.createElement("div", { className: "bg-neutral-100 dark:bg-neutral-800 rounded-[20px] rounded-bl-[4px] px-4 py-3" },
                            React.createElement("div", { className: "flex gap-1.5 items-center" },
                                React.createElement("span", { className: cn(theme.loading) }),
                                React.createElement("span", { className: cn(theme.loading), style: { animationDelay: "0.15s" } }),
                                React.createElement("span", { className: cn(theme.loading), style: { animationDelay: "0.3s" } }))))),
                    React.createElement("div", { ref: messagesEndRef }))),
            showScrollButton && (React.createElement(ConversationScrollButton, { onClick: () => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }) }))),
        error && (React.createElement("div", { className: "mx-4 mb-2 px-4 py-3 bg-red-50 dark:bg-red-900/20 rounded-2xl text-red-600 dark:text-red-400 text-sm flex items-center justify-between gap-3" },
            React.createElement("span", null, error.message),
            reload && (React.createElement("button", { type: "button", onClick: reload, className: "inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-600 dark:text-red-400 bg-red-100 dark:bg-red-900/40 hover:bg-red-200 dark:hover:bg-red-900/60 rounded-lg transition-colors" },
                React.createElement(RefreshCwIcon, { className: "size-3.5" }),
                "Retry")))),
        React.createElement("div", { className: "flex-shrink-0 bg-white dark:bg-neutral-900 border-t border-neutral-200 dark:border-neutral-800" },
            React.createElement("form", { onSubmit: submitHandler, className: "max-w-2xl mx-auto px-4 py-3" },
                React.createElement("div", { className: "flex gap-2 items-center" },
                    React.createElement(InputBox, { value: voice.isListening ? voice.transcript || input : input, onChange: inputChangeHandler, placeholder: voice.isListening ? "Listening..." : placeholder, disabled: isLoading || voice.isListening, multiline: multiline, className: theme.input }),
                    React.createElement(SubmitButton, { isLoading: isLoading || voice.isListening, hasInput: !!input.trim(), onStop: voice.isListening ? voice.stop : stop, onVoice: voiceHandler, disabled: !input.trim(), className: theme.button }))))));
});
Chat.displayName = "Chat";
export const ChatComponents = Object.assign(Chat, {
    Header: ChatHeader,
    Messages: ChatMessages,
    Input: ChatInput,
    Footer: ChatFooter,
});
