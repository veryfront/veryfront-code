/**
 * Message Parts Utilities
 * @module ai/react/components/chat/utils/message-parts
 */
import type { DynamicToolUIPart, ToolUIPart, UIMessage, UIMessagePart } from "../../../../../agent/react/index.js";
/** Get text content from UIMessage parts */
export declare function getTextContent(message: UIMessage): string;
/** Check if a part is a tool part */
export declare function isToolPart(part: UIMessagePart): part is ToolUIPart | DynamicToolUIPart;
/** Check if a part is a reasoning part */
export declare function isReasoningPart(part: UIMessagePart): part is {
    type: "reasoning";
    text: string;
    state?: "streaming" | "done";
};
/**
 * Part group types for ordered rendering
 */
export type PartGroup = {
    type: "text";
    content: string;
} | {
    type: "tool";
    tool: ToolUIPart | DynamicToolUIPart;
} | {
    type: "reasoning";
    text: string;
    isStreaming: boolean;
};
/**
 * Group consecutive parts for ordered rendering
 * Returns an array of groups, each containing either consecutive text parts, a tool part, or a reasoning part
 */
export declare function groupPartsInOrder(parts: UIMessagePart[]): PartGroup[];
//# sourceMappingURL=message-parts.d.ts.map