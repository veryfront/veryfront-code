/**
 * Message Parts Utilities
 * @module ai/react/components/chat/utils/message-parts
 */
/** Get text content from UIMessage parts */
export function getTextContent(message) {
    return message.parts
        .filter((p) => p.type === "text")
        .map((p) => p.text)
        .join("");
}
/** Check if a part is a tool part */
export function isToolPart(part) {
    return ((part.type.startsWith("tool-") && part.type !== "tool-result") ||
        part.type === "dynamic-tool");
}
/** Check if a part is a reasoning part */
export function isReasoningPart(part) {
    return part.type === "reasoning";
}
/**
 * Group consecutive parts for ordered rendering
 * Returns an array of groups, each containing either consecutive text parts, a tool part, or a reasoning part
 */
export function groupPartsInOrder(parts) {
    const groups = [];
    let textBuffer = "";
    const flushText = () => {
        if (!textBuffer)
            return;
        groups.push({ type: "text", content: textBuffer });
        textBuffer = "";
    };
    for (const part of parts) {
        if (part.type === "text") {
            textBuffer += part.text;
            continue;
        }
        if (isToolPart(part)) {
            flushText();
            groups.push({ type: "tool", tool: part });
            continue;
        }
        if (isReasoningPart(part)) {
            flushText();
            groups.push({
                type: "reasoning",
                text: part.text,
                isStreaming: part.state === "streaming",
            });
        }
        // Skip tool-result and other non-renderable parts
    }
    flushText();
    return groups;
}
