import * as React from "react";
import type { ToolUIPart, UIMessage, UIMessagePart } from "../../../agent/react/index.js";
import { type ChatTheme } from "./theme.js";
export interface MessageProps {
    /** Message to display (v5 UIMessage format) */
    message: UIMessage;
    /** Additional class name */
    className?: string;
    /** Theme customization */
    theme?: Partial<ChatTheme>;
    /** Show role label */
    showRole?: boolean;
    /** Show timestamp */
    showTimestamp?: boolean;
    /** Custom renderer for tool calls (matches tool-${toolName} pattern) */
    renderToolCall?: (part: ToolUIPart) => React.ReactNode;
    /** Custom renderer for dynamic tools */
    renderDynamicTool?: (part: Extract<UIMessagePart, {
        type: "dynamic-tool";
    }>) => React.ReactNode;
    /** Custom renderer for reasoning */
    renderReasoning?: (part: Extract<UIMessagePart, {
        type: "reasoning";
    }>) => React.ReactNode;
}
export declare const Message: React.ForwardRefExoticComponent<MessageProps & React.RefAttributes<HTMLDivElement>>;
export interface StreamingMessageProps {
    /** Streaming parts (v5 format) */
    parts: UIMessagePart[];
    /** Show typing cursor */
    showCursor?: boolean;
    /** Additional class name */
    className?: string;
    /** Theme customization */
    theme?: Partial<ChatTheme>;
}
export declare const StreamingMessage: React.ForwardRefExoticComponent<StreamingMessageProps & React.RefAttributes<HTMLDivElement>>;
//# sourceMappingURL=message.d.ts.map