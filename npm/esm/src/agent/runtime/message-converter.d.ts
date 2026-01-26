/**
 * Message Converter
 *
 * Converts between AI SDK v5 message format and provider formats.
 */
import { type Message } from "../types.js";
/**
 * Provider message format (OpenAI-compatible)
 */
export interface ProviderMessage {
    role: string;
    content: string;
    tool_calls?: Array<{
        id: string;
        type: string;
        function: {
            name: string;
            arguments: string;
        };
    }>;
    tool_call_id?: string;
}
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
export declare function convertMessageToProvider(msg: Message): ProviderMessage;
/**
 * Convert provider message back to AI SDK v5 format
 */
export declare function convertProviderToMessage(providerMsg: ProviderMessage, messageId?: string): Message;
//# sourceMappingURL=message-converter.d.ts.map