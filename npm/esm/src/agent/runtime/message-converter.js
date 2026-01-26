/**
 * Message Converter
 *
 * Converts between AI SDK v5 message format and provider formats.
 */
import { getTextFromParts, getToolArguments, } from "../types.js";
/**
 * Convert AI SDK v5 Message to provider format.
 *
 * Handles:
 * - Text content extraction from parts
 * - Tool calls (both tool-${toolName} and legacy tool-call patterns)
 * - Tool results
 *
 * Empty parts array results in empty content string, which is valid for
 * providers (e.g., assistant message with only tool calls, no text).
 */
export function convertMessageToProvider(msg) {
    const providerMsg = {
        role: msg.role,
        content: getTextFromParts(msg.parts),
    };
    const toolResultPart = msg.parts.find((p) => p.type === "tool-result");
    if (toolResultPart && msg.role === "tool") {
        providerMsg.tool_call_id = toolResultPart.toolCallId;
        providerMsg.content = JSON.stringify(toolResultPart.result);
        return providerMsg;
    }
    const toolCallParts = msg.parts.filter((p) => p.type === "tool-call" || (p.type.startsWith("tool-") && p.type !== "tool-result"));
    if (toolCallParts.length) {
        providerMsg.tool_calls = toolCallParts.map((tc) => ({
            id: tc.toolCallId,
            type: "function",
            function: {
                name: tc.toolName,
                arguments: JSON.stringify(getToolArguments(tc)),
            },
        }));
    }
    return providerMsg;
}
/**
 * Convert provider message back to AI SDK v5 format
 */
export function convertProviderToMessage(providerMsg, messageId) {
    const parts = [];
    if (providerMsg.content) {
        parts.push({ type: "text", text: providerMsg.content });
    }
    for (const tc of providerMsg.tool_calls ?? []) {
        let args = {};
        try {
            args = JSON.parse(tc.function.arguments);
        }
        catch {
            // Keep empty args on parse failure
        }
        parts.push({
            type: `tool-${tc.function.name}`,
            toolCallId: tc.id,
            toolName: tc.function.name,
            args,
        });
    }
    if (typeof messageId === "string" && messageId.trim().length === 0) {
        throw new Error("Message id cannot be empty.");
    }
    const resolvedId = messageId ?? `msg_${Date.now()}`;
    return {
        id: resolvedId,
        role: providerMsg.role,
        parts,
        timestamp: Date.now(),
    };
}
