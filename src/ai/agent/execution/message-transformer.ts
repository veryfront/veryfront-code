/**
 * Message Transformer
 *
 * Transforms internal Message format to provider-specific formats.
 * Extracted from AgentRuntime to centralize message conversion logic.
 */

import type { Message, ToolCall } from "../../types/agent.ts";

/**
 * Provider message format (matches OpenAI/Anthropic API structure)
 */
export interface ProviderMessage {
  role: string;
  content: string;
  tool_calls?: Array<{
    id: string;
    type?: string;
    function: {
      name: string;
      arguments: string;
    };
  }>;
  tool_call_id?: string;
}

/**
 * Message transformer for converting between internal and provider formats.
 *
 * Usage:
 * ```ts
 * const transformer = new MessageTransformer();
 * const providerMessages = transformer.toProviderFormat(messages);
 * ```
 */
export class MessageTransformer {
  /**
   * Convert internal messages to provider format.
   */
  toProviderFormat(messages: Message[]): ProviderMessage[] {
    return messages.map((m) => this.convertMessage(m));
  }

  /**
   * Convert a single message to provider format.
   */
  convertMessage(message: Message): ProviderMessage {
    const providerMsg: ProviderMessage = {
      role: message.role,
      content: message.content,
    };

    // Include tool_calls for assistant messages
    if (message.role === "assistant" && message.toolCalls) {
      providerMsg.tool_calls = message.toolCalls.map((tc) => ({
        id: tc.id,
        type: "function",
        function: {
          name: tc.name,
          arguments: JSON.stringify(tc.arguments),
        },
      }));
    }

    // Include tool_call_id for tool result messages
    if (message.role === "tool" && message.toolCallId) {
      providerMsg.tool_call_id = message.toolCallId;
    }

    return providerMsg;
  }

  /**
   * Create a new assistant message from provider response.
   */
  createAssistantMessage(
    text: string,
    toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>,
    step?: number,
  ): Message {
    const message: Message = {
      id: `msg_${Date.now()}_${step ?? 0}`,
      role: "assistant",
      content: text,
      timestamp: Date.now(),
    };

    if (toolCalls && toolCalls.length > 0) {
      message.toolCalls = toolCalls;
    }

    return message;
  }

  /**
   * Create a tool message (result or error).
   */
  private createToolMessage(
    toolCallId: string,
    content: string,
    toolCall: ToolCall,
    isError = false,
  ): Message {
    return {
      id: `${isError ? "tool_error_" : "tool_"}${toolCallId}`,
      role: "tool",
      content,
      toolCallId,
      toolCall,
      timestamp: Date.now(),
    };
  }

  /**
   * Create a tool result message.
   */
  createToolResultMessage(
    toolCallId: string,
    result: unknown,
    toolCall: ToolCall,
  ): Message {
    return this.createToolMessage(toolCallId, JSON.stringify(result), toolCall);
  }

  /**
   * Create a tool error message.
   */
  createToolErrorMessage(
    toolCallId: string,
    error: string,
    toolCall: ToolCall,
  ): Message {
    return this.createToolMessage(toolCallId, `Error: ${error}`, toolCall, true);
  }

  /**
   * Create a user message from string input.
   */
  createUserMessage(content: string): Message {
    return {
      id: `msg_${Date.now()}`,
      role: "user",
      content,
      timestamp: Date.now(),
    };
  }

  /**
   * Normalize input to messages array.
   * Handles both v4 format (content string) and v5 format (parts array).
   */
  normalizeInput(input: string | Message[]): Message[] {
    if (typeof input === "string") {
      return [this.createUserMessage(input)];
    }

    return input.map((msg) => {
      // Handle v5 UIMessage format with parts array
      const msgAny = msg as unknown as Record<string, unknown>;
      let content = msg.content;

      if (!content && Array.isArray(msgAny.parts)) {
        // Extract text from parts array (v5 format)
        content = (msgAny.parts as Array<{ type: string; text?: string }>)
          .filter((p) => p.type === "text" && p.text)
          .map((p) => p.text)
          .join("");
      }

      return {
        ...msg,
        content: content || "",
        id: msg.id || `msg_${Date.now()}`,
        timestamp: msg.timestamp || Date.now(),
      };
    });
  }
}

/**
 * Create a new message transformer instance.
 */
export function createMessageTransformer(): MessageTransformer {
  return new MessageTransformer();
}
