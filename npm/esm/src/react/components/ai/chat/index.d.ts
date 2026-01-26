import * as React from "react";
import type { DynamicToolUIPart, ToolUIPart, UIMessage } from "../../../../agent/react/index.js";
import { type ChatTheme } from "../theme.js";
export { Loader, Shimmer } from "./components/animations.js";
export { ReasoningCard } from "./components/reasoning.js";
export { ConversationEmptyState, type ConversationEmptyStateProps, ConversationScrollButton, type ConversationScrollButtonProps, Suggestion, type SuggestionProps, Suggestions, type SuggestionsProps, } from "./components/empty-state.js";
export { MessageActions, type MessageActionsProps } from "./components/message-actions.js";
export { ToolCallCard, ToolStatusBadge } from "./components/tool-ui.js";
export { getTextContent, groupPartsInOrder, isReasoningPart, isToolPart, type PartGroup, } from "./utils/message-parts.js";
export { ChatFooter, ChatHeader, ChatInput, ChatMessages } from "./composition/api.js";
export interface ChatProps {
    messages: UIMessage[];
    input: string;
    onChange?: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
    handleInputChange?: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
    onSubmit?: (e: React.FormEvent) => void | Promise<void>;
    handleSubmit?: (e: React.FormEvent) => void | Promise<void>;
    stop?: () => void;
    reload?: () => void;
    enableVoice?: boolean;
    onVoice?: () => void;
    setInput?: (value: string) => void;
    isLoading?: boolean;
    error?: Error | null;
    placeholder?: string;
    maxHeight?: string;
    className?: string;
    theme?: Partial<ChatTheme>;
    renderMessage?: (message: UIMessage) => React.ReactNode;
    renderTool?: (tool: ToolUIPart | DynamicToolUIPart) => React.ReactNode;
    multiline?: boolean;
    suggestions?: string[];
    onSuggestionClick?: (suggestion: string) => void;
    emptyState?: {
        icon?: React.ReactNode;
        title?: string;
        description?: string;
    };
    showScrollButton?: boolean;
    showMessageActions?: boolean;
}
export declare const Chat: React.ForwardRefExoticComponent<ChatProps & React.RefAttributes<HTMLDivElement>>;
export declare const ChatComponents: React.ForwardRefExoticComponent<ChatProps & React.RefAttributes<HTMLDivElement>> & {
    Header: React.ForwardRefExoticComponent<React.HTMLAttributes<HTMLDivElement> & React.RefAttributes<HTMLDivElement>>;
    Messages: React.ForwardRefExoticComponent<import("../../../index.js").MessageListProps & React.RefAttributes<HTMLDivElement>>;
    Input: React.ForwardRefExoticComponent<Omit<import("../../../index.js").InputBoxProps & React.RefAttributes<HTMLInputElement | HTMLTextAreaElement>, "ref"> & React.RefAttributes<HTMLInputElement | HTMLTextAreaElement>>;
    Footer: React.ForwardRefExoticComponent<React.HTMLAttributes<HTMLDivElement> & React.RefAttributes<HTMLDivElement>>;
};
//# sourceMappingURL=index.d.ts.map