/** Anthropic provider implementation */

import { BaseProvider } from "./base.ts";
import { createError, toError } from "#veryfront/errors/veryfront-error.ts";
import type { AnthropicConfig, CompletionRequest, CompletionResponse } from "./types.ts";
import { agentLogger } from "#veryfront/utils/logger/logger.ts";

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
    this.baseURL = config.baseURL ?? "https://api.anthropic.com";
  }

  protected getHeaders(): Record<string, string> {
    return {
      "x-api-key": this.apiKey,
      "anthropic-version": "2023-06-01",
    };
  }

  protected getEndpoint(_path: string): string {
    return `${this.baseURL}/v1/messages`;
  }

  protected transformRequest(request: CompletionRequest): Record<string, unknown> {
    const transformedMessages = request.messages.map((msg): AnthropicMessage => {
      if (msg.role === "tool") {
        if (!msg.tool_call_id) {
          throw toError(
            createError({
              type: "agent",
              message: "Tool result message missing tool_call_id",
            }),
          );
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

      if (msg.role === "assistant") {
        if (!msg.tool_calls?.length) return { role: "assistant", content: msg.content };

        const content: AnthropicContentBlock[] = [];

        if (msg.content) content.push({ type: "text", text: msg.content });

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

        return { role: "assistant", content };
      }

      return { role: "user", content: msg.content };
    });

    agentLogger.debug(
      "Anthropic transformRequest - transformed messages:",
      JSON.stringify(transformedMessages, null, 2),
    );

    const body: Record<string, unknown> = {
      model: request.model,
      messages: transformedMessages,
      stream: request.stream ?? false,
      max_tokens: request.maxTokens ?? 4096,
    };

    if (request.system) body.system = request.system;
    if (request.temperature !== undefined) body.temperature = request.temperature;
    if (request.topP !== undefined) body.top_p = request.topP;

    if (request.tools?.length) {
      body.tools = request.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.parameters,
      }));
    }

    return body;
  }

  protected transformResponse(response: AnthropicResponse): CompletionResponse {
    const { content } = response;

    if (!Array.isArray(content)) {
      throw toError(
        createError({
          type: "config",
          message: "Anthropic: Invalid response format",
        }),
      );
    }

    const text = content
      .filter((c): c is AnthropicTextContent => c.type === "text")
      .map((c) => c.text)
      .join("");

    const toolCalls = content
      .filter((c): c is AnthropicToolUseContent => c.type === "tool_use")
      .map((c) => ({
        id: c.id,
        name: c.name,
        arguments: c.input,
      }));

    const promptTokens = response.usage?.input_tokens ?? 0;
    const completionTokens = response.usage?.output_tokens ?? 0;

    return {
      text,
      toolCalls: toolCalls.length ? toolCalls : undefined,
      usage: {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
      },
      finishReason: this.mapStopReason(response.stop_reason),
    };
  }

  private mapStopReason(reason: string): CompletionResponse["finishReason"] {
    const STOP_REASON_MAP: Record<string, CompletionResponse["finishReason"]> = {
      end_turn: "stop",
      max_tokens: "length",
      tool_use: "tool_calls",
      stop_sequence: "stop",
    };

    return STOP_REASON_MAP[reason] ?? "stop";
  }

  protected override transformStream(stream: ReadableStream): ReadableStream {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    const mapStopReason = this.mapStopReason.bind(this);

    const toolCalls = new Map<
      number,
      {
        id?: string;
        name?: string;
        input: string;
      }
    >();

    let currentBlockIndex = 0;

    function enqueue(controller: ReadableStreamDefaultController, payload: unknown): void {
      controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
    }

    return new ReadableStream({
      async start(controller) {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              controller.close();
              return;
            }

            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split("\n").filter((line) => line.trim());

            for (const line of lines) {
              if (!line.startsWith("data: ")) continue;

              const data = line.slice(6);

              try {
                const parsed = JSON.parse(data);

                if (parsed.type === "message_start") {
                  const usage = parsed.message?.usage;
                  if (!usage) continue;

                  const promptTokens = usage.input_tokens ?? 0;
                  const completionTokens = usage.output_tokens ?? 0;

                  enqueue(controller, {
                    type: "usage",
                    usage: {
                      promptTokens,
                      completionTokens,
                      totalTokens: promptTokens + completionTokens,
                    },
                  });
                  continue;
                }

                if (parsed.type === "content_block_start") {
                  const block = parsed.content_block;
                  if (block?.type !== "tool_use") continue;

                  const index = parsed.index ?? currentBlockIndex;
                  currentBlockIndex = index;

                  toolCalls.set(index, { id: block.id, name: block.name, input: "" });

                  enqueue(controller, {
                    type: "tool_call_start",
                    toolCall: { id: block.id, name: block.name, index },
                  });
                  continue;
                }

                if (parsed.type === "content_block_delta") {
                  const delta = parsed.delta;

                  if (delta?.type === "text_delta" && delta.text) {
                    enqueue(controller, { type: "content", content: delta.text });
                  }

                  if (delta?.type === "input_json_delta" && delta.partial_json) {
                    const index = parsed.index ?? currentBlockIndex;
                    const tc = toolCalls.get(index);
                    if (!tc) continue;

                    tc.input += delta.partial_json;

                    enqueue(controller, {
                      type: "tool_call_delta",
                      id: tc.id,
                      index,
                      arguments: delta.partial_json,
                    });
                  }

                  continue;
                }

                if (parsed.type === "message_delta") {
                  if (parsed.usage) {
                    const completionTokens = parsed.usage.output_tokens ?? 0;

                    enqueue(controller, {
                      type: "usage",
                      usage: {
                        promptTokens: 0,
                        completionTokens,
                        totalTokens: completionTokens,
                      },
                    });
                  }

                  const stopReason = parsed.delta?.stop_reason;
                  if (!stopReason) continue;

                  if (stopReason === "tool_use") {
                    for (const [index, tc] of toolCalls.entries()) {
                      enqueue(controller, {
                        type: "tool_call_complete",
                        toolCall: {
                          id: tc.id!,
                          name: tc.name!,
                          index,
                          arguments: tc.input,
                        },
                      });
                    }
                  }

                  enqueue(controller, {
                    type: "finish",
                    finishReason: mapStopReason(stopReason),
                  });
                }
              } catch (e) {
                agentLogger.warn("Failed to parse stream chunk:", e);
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
