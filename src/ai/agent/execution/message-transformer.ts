import type { Message, ToolCall } from "../../types/agent.ts";

/** Provider message format (matches OpenAI/Anthropic API structure) */
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

/** Message transformer for converting between internal and provider formats. */
export class MessageTransformer {
  toProviderFormat(messages: Message[]): ProviderMessage[] {
    return messages.map((m) => this.convertMessage(m));
  }

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

    if (toolCalls?.length) {
      message.toolCalls = toolCalls;
    }

    return message;
  }

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

  createToolResultMessage(
    toolCallId: string,
    result: unknown,
    toolCall: ToolCall,
  ): Message {
    return this.createToolMessage(toolCallId, JSON.stringify(result), toolCall);
  }

  createToolErrorMessage(
    toolCallId: string,
    error: string,
    toolCall: ToolCall,
  ): Message {
    return this.createToolMessage(toolCallId, `Error: ${error}`, toolCall, true);
  }

  createUserMessage(content: string): Message {
    return {
      id: `msg_${Date.now()}`,
      role: "user",
      content,
      timestamp: Date.now(),
    };
  }

  /** Normalize input to messages array (handles both v4 and v5 formats). */
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

export function createMessageTransformer(): MessageTransformer {
  return new MessageTransformer();
}
