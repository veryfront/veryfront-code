/** Anthropic provider implementation */

import { BaseProvider } from "./base.ts";
import { createError, toError } from "../../core/errors/veryfront-error.ts";
import type { AnthropicConfig, CompletionRequest, CompletionResponse } from "../types/provider.ts";
import { agentLogger } from "../../core/utils/logger/logger.ts";

interface AnthropicTextContent {
  type: "text";
  text: string;
}

interface AnthropicToolUseContent {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

interface AnthropicToolResultContent {
  type: "tool_result";
  tool_use_id: string;
  content: string;
}

type AnthropicContentBlock =
  | AnthropicTextContent
  | AnthropicToolUseContent
  | AnthropicToolResultContent;

interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | AnthropicContentBlock[];
}

interface AnthropicResponse {
  content: AnthropicContentBlock[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
  stop_reason: string;
}

export class AnthropicProvider extends BaseProvider {
  name = "anthropic";
  private apiKey: string;
  private baseURL: string;

  constructor(config: AnthropicConfig) {
    super(config);
    this.apiKey = config.apiKey;
    this.baseURL = config.baseURL || "https://api.anthropic.com";
  }

  protected getHeaders(): Record<string, string> {
    return {
      "x-api-key": this.apiKey,
      "anthropic-version": "2023-06-01",
    };
  }

  protected getEndpoint(_path: string): string {
    // Anthropic uses /v1/messages endpoint
    return `${this.baseURL}/v1/messages`;
  }

  protected transformRequest(
    request: CompletionRequest,
  ): Record<string, unknown> {
    // Transform messages to Anthropic format
    // Anthropic doesn't support "tool" role - tool results must be sent as "user" messages
    const transformedMessages = request.messages.map((msg): AnthropicMessage => {
      if (msg.role === "tool") {
        // Convert tool result message to user message with tool_result content block
        if (!msg.tool_call_id) {
          throw toError(createError({
            type: "agent",
            message: "Tool result message missing tool_call_id",
          }));
        }
        return {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: msg.tool_call_id,
              content: msg.content,
            },
          ],
        };
      }

      // Transform assistant messages with tool_calls to Anthropic format
      if (msg.role === "assistant" && msg.tool_calls && msg.tool_calls.length > 0) {
        const content: AnthropicContentBlock[] = [];

        // Add text content if present
        if (msg.content) {
          content.push({
            type: "text",
            text: msg.content,
          });
        }

        // Add tool use blocks (runtime sends OpenAI-format tool_calls)
        for (const toolCall of msg.tool_calls) {
          content.push({
            type: "tool_use",
            id: toolCall.id,
            name: toolCall.function.name,
            input: typeof toolCall.function.arguments === "string"
              ? JSON.parse(toolCall.function.arguments)
              : toolCall.function.arguments,
          });
        }

        return {
          role: "assistant",
          content,
        };
      }

      // For all other assistant messages, ensure only role and content are sent
      if (msg.role === "assistant") {
        return {
          role: "assistant",
          content: msg.content,
        };
      }

      // For user messages, only send role and content
      if (msg.role === "user") {
        return {
          role: "user",
          content: msg.content,
        };
      }

      // Fallback for any other message types - cast to unknown format
      return msg as unknown as AnthropicMessage;
    });

    // Debug: Log transformed messages
    agentLogger.debug(
      "Anthropic transformRequest - transformed messages:",
      JSON.stringify(transformedMessages, null, 2),
    );

    const body: Record<string, unknown> = {
      model: request.model,
      messages: transformedMessages,
      stream: request.stream || false,
    };

    // Anthropic requires system prompt as separate field
    if (request.system) {
      body.system = request.system;
    }

    if (request.maxTokens) {
      body.max_tokens = request.maxTokens;
    } else {
      // Anthropic requires max_tokens
      body.max_tokens = 4096;
    }

    if (request.temperature !== undefined) {
      body.temperature = request.temperature;
    }

    if (request.topP !== undefined) {
      body.top_p = request.topP;
    }

    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.parameters,
      }));
    }

    return body;
  }

  protected transformResponse(response: AnthropicResponse): CompletionResponse {
    const content = response.content;

    if (!content || !Array.isArray(content)) {
      throw toError(createError({
        type: "config",
        message: "Anthropic: Invalid response format",
      }));
    }

    // Extract text content
    const textContent = content
      .filter((c): c is AnthropicTextContent => c.type === "text")
      .map((c) => c.text)
      .join("");

    // Extract tool calls
    const toolCalls = content
      .filter((c): c is AnthropicToolUseContent => c.type === "tool_use")
      .map((c) => ({
        id: c.id,
        name: c.name,
        arguments: c.input,
      }));

    return {
      text: textContent,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: {
        promptTokens: response.usage?.input_tokens || 0,
        completionTokens: response.usage?.output_tokens || 0,
        totalTokens: (response.usage?.input_tokens || 0) +
          (response.usage?.output_tokens || 0),
      },
      finishReason: this.mapStopReason(response.stop_reason),
    };
  }

  private mapStopReason(reason: string): CompletionResponse["finishReason"] {
    switch (reason) {
      case "end_turn":
        return "stop";
      case "max_tokens":
        return "length";
      case "tool_use":
        return "tool_calls";
      case "stop_sequence":
        return "stop";
      default:
        return "stop";
    }
  }

  protected override transformStream(stream: ReadableStream): ReadableStream {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();

    // Capture mapStopReason method reference before entering ReadableStream context
    const mapStopReason = this.mapStopReason.bind(this);

    // Track tool calls being accumulated
    const toolCalls = new Map<number, {
      id?: string;
      name?: string;
      input: string;
    }>();

    let currentBlockIndex = 0;

    return new ReadableStream({
      async start(controller) {
        try {
          while (true) {
            const { done, value } = await reader.read();

            if (done) {
              controller.close();
              break;
            }

            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split("\n").filter((line) => line.trim());

            for (const line of lines) {
              if (line.startsWith("data: ")) {
                const data = line.slice(6);

                try {
                  const parsed = JSON.parse(data);

                  // Anthropic stream event types:
                  // - message_start: Contains model, role, usage
                  // - content_block_start: Start of content/tool_use block
                  // - content_block_delta: Text or tool input deltas
                  // - content_block_stop: End of block
                  // - message_delta: Contains stop_reason, usage delta
                  // - message_stop: End of message

                  if (parsed.type === "message_start") {
                    // Extract and emit initial usage (input tokens)
                    if (parsed.message?.usage) {
                      const usageEvent = JSON.stringify({
                        type: "usage",
                        usage: {
                          promptTokens: parsed.message.usage.input_tokens || 0,
                          completionTokens: parsed.message.usage.output_tokens || 0,
                          totalTokens: (parsed.message.usage.input_tokens || 0) +
                            (parsed.message.usage.output_tokens || 0),
                        },
                      });
                      controller.enqueue(encoder.encode(usageEvent + "\n"));
                    }
                  } else if (parsed.type === "content_block_start") {
                    const block = parsed.content_block;

                    // Track tool use blocks
                    if (block?.type === "tool_use") {
                      const index = parsed.index ?? currentBlockIndex;
                      currentBlockIndex = index;

                      toolCalls.set(index, {
                        id: block.id,
                        name: block.name,
                        input: "",
                      });

                      // Emit tool call start event
                      const startEvent = JSON.stringify({
                        type: "tool_call_start",
                        toolCall: {
                          id: block.id,
                          name: block.name,
                          index,
                        },
                      });
                      controller.enqueue(encoder.encode(startEvent + "\n"));
                    }
                  } else if (parsed.type === "content_block_delta") {
                    const delta = parsed.delta;

                    // Handle text content deltas
                    if (delta?.type === "text_delta" && delta.text) {
                      const contentEvent = JSON.stringify({
                        type: "content",
                        content: delta.text,
                      });
                      controller.enqueue(encoder.encode(contentEvent + "\n"));
                    }

                    // Handle tool input deltas
                    if (delta?.type === "input_json_delta" && delta.partial_json) {
                      const index = parsed.index ?? currentBlockIndex;
                      const tc = toolCalls.get(index);

                      if (tc) {
                        tc.input += delta.partial_json;

                        // Emit tool call delta event
                        const deltaEvent = JSON.stringify({
                          type: "tool_call_delta",
                          id: tc.id,
                          index,
                          arguments: delta.partial_json,
                        });
                        controller.enqueue(encoder.encode(deltaEvent + "\n"));
                      }
                    }
                  } else if (parsed.type === "message_delta") {
                    // Extract and emit usage delta (output tokens)
                    if (parsed.usage) {
                      const usageDeltaEvent = JSON.stringify({
                        type: "usage",
                        usage: {
                          promptTokens: 0, // Only output tokens in delta
                          completionTokens: parsed.usage.output_tokens || 0,
                          totalTokens: parsed.usage.output_tokens || 0,
                        },
                      });
                      controller.enqueue(encoder.encode(usageDeltaEvent + "\n"));
                    }

                    // Handle stop reason
                    if (parsed.delta?.stop_reason) {
                      const stopReason = parsed.delta.stop_reason;

                      // Emit complete tool calls if stop reason is tool_use
                      if (stopReason === "tool_use") {
                        for (const [index, tc] of toolCalls.entries()) {
                          const completeEvent = JSON.stringify({
                            type: "tool_call_complete",
                            toolCall: {
                              id: tc.id!,
                              name: tc.name!,
                              index,
                              arguments: tc.input,
                            },
                          });
                          controller.enqueue(encoder.encode(completeEvent + "\n"));
                        }
                      }

                      // Map Anthropic stop reason to our format
                      const finishReason = mapStopReason(stopReason);

                      // Emit finish event
                      const finishEvent = JSON.stringify({
                        type: "finish",
                        finishReason,
                      });
                      controller.enqueue(encoder.encode(finishEvent + "\n"));
                    }
                  }
                } catch (e) {
                  // Skip invalid JSON
                  agentLogger.warn("Failed to parse stream chunk:", e);
                }
              }
            }
          }
        } catch (error) {
          controller.error(error);
        }
      },

      cancel() {
        reader.cancel();
      },
    });
  }
}
