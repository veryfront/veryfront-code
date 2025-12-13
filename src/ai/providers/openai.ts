/**
 * OpenAI provider implementation
 *
 * Supports both Chat Completions API and Responses API for reasoning models.
 * When reasoning is enabled, uses the Responses API (/v1/responses) which
 * returns reasoning summaries in the streaming response.
 */

import { z } from "zod";
import { BaseProvider } from "./base.ts";
import { createError, toError } from "../../core/errors/veryfront-error.ts";
import type { CompletionRequest, CompletionResponse, OpenAIConfig } from "../types/provider.ts";
import { agentLogger } from "../../core/utils/logger/logger.ts";

const OpenAIToolCallSchema = z.object({
  id: z.string(),
  function: z.object({
    name: z.string(),
    arguments: z.string(),
  }),
});

const OpenAIResponseSchema = z.object({
  choices: z.array(z.object({
    message: z.object({
      content: z.string().nullable().optional(),
      tool_calls: z.array(OpenAIToolCallSchema).optional(),
    }),
    finish_reason: z.string(),
  })).min(1),
  usage: z.object({
    prompt_tokens: z.number().optional(),
    completion_tokens: z.number().optional(),
    total_tokens: z.number().optional(),
  }).optional(),
});

export class OpenAIProvider extends BaseProvider {
  name = "openai";
  private apiKey: string;
  private baseURL: string;
  private organizationId?: string;

  constructor(config: OpenAIConfig) {
    super(config);
    this.apiKey = config.apiKey;
    this.baseURL = config.baseURL || "https://api.openai.com/v1";
    this.organizationId = config.organizationId;
  }

  protected getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "Authorization": `Bearer ${this.apiKey}`,
    };

    if (this.organizationId) {
      headers["OpenAI-Organization"] = this.organizationId;
    }

    return headers;
  }

  protected getEndpoint(path: string): string {
    return `${this.baseURL}${path}`;
  }

  protected transformRequest(
    request: CompletionRequest,
  ): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: request.model,
      messages: request.messages,
      stream: request.stream || false,
    };

    if (request.system) {
      // Add system message at the beginning
      body.messages = [
        { role: "system", content: request.system },
        ...request.messages,
      ];
    }

    // o-series models (o1, o3) use different parameter names
    const isOSeriesModel = request.model.startsWith("o1") || request.model.startsWith("o3");

    if (request.maxTokens) {
      // o-series models use max_completion_tokens instead of max_tokens
      if (isOSeriesModel) {
        body.max_completion_tokens = request.maxTokens;
      } else {
        body.max_tokens = request.maxTokens;
      }
    }

    // o-series models don't support temperature parameter
    if (request.temperature !== undefined && !isOSeriesModel) {
      body.temperature = request.temperature;
    }

    if (request.topP !== undefined) {
      body.top_p = request.topP;
    }

    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools.map((tool) => ({
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      }));
      // Disable parallel tool calls to avoid streaming JSON corruption
      // when multiple tool calls are made simultaneously
      // Note: o-series models (o1, o3) don't support this parameter
      if (!isOSeriesModel) {
        body.parallel_tool_calls = false;
      }
    }

    // Add reasoning effort for o-series models (o1, o3, etc.)
    if (request.reasoning?.enabled && request.reasoning.effort) {
      body.reasoning_effort = request.reasoning.effort;
    }

    return body;
  }

  protected transformResponse(response: unknown): CompletionResponse {
    const parsed = OpenAIResponseSchema.safeParse(response);

    if (!parsed.success) {
      throw toError(createError({
        type: "agent",
        message: `OpenAI: Invalid response format: ${parsed.error.message}`,
      }));
    }

    const data = parsed.data;
    const choice = data.choices[0];

    if (!choice) {
      throw toError(createError({
        type: "agent",
        message: "OpenAI: No choices in response (unexpected)",
      }));
    }

    const message = choice.message;

    const toolCalls = message.tool_calls?.map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: JSON.parse(tc.function.arguments),
    }));

    return {
      text: message.content || "",
      toolCalls,
      usage: {
        promptTokens: data.usage?.prompt_tokens || 0,
        completionTokens: data.usage?.completion_tokens || 0,
        totalTokens: data.usage?.total_tokens || 0,
      },
      finishReason: this.mapFinishReason(choice.finish_reason),
    };
  }

  private mapFinishReason(reason: string): CompletionResponse["finishReason"] {
    switch (reason) {
      case "stop":
        return "stop";
      case "length":
        return "length";
      case "tool_calls":
      case "function_call":
        return "tool_calls";
      case "content_filter":
        return "content_filter";
      default:
        return "stop";
    }
  }

  /**
   * Override stream method to use Responses API for reasoning models.
   *
   * The Responses API (/v1/responses) returns reasoning summaries in the stream,
   * while the Chat Completions API does not expose reasoning content.
   *
   * Note: Responses API has a different message format that doesn't fully support
   * multi-turn tool calling conversations yet. For now, we only use it when:
   * - It's a reasoning model (o1, o3)
   * - Reasoning is enabled
   * - No tools are involved (simpler conversations)
   */
  async stream(request: CompletionRequest): Promise<ReadableStream> {
    // Check if this is a reasoning model request
    const isOSeriesModel = request.model.startsWith("o1") || request.model.startsWith("o3");
    const hasTools = request.tools && request.tools.length > 0;

    // Only use Responses API for reasoning models without tools
    // Tool calling with Responses API requires a different message format
    // that we haven't fully implemented yet
    const useResponsesApi = isOSeriesModel && request.reasoning?.enabled && !hasTools;

    if (useResponsesApi) {
      agentLogger.info("[OPENAI] Using Responses API for reasoning without tools");
      return this.streamWithResponsesApi(request);
    }

    // Use default Chat Completions API streaming
    // This includes:
    // - Non-reasoning models
    // - Reasoning models with tools (uses reasoning_effort parameter)
    return super.stream(request);
  }

  /**
   * Stream using OpenAI Responses API (/v1/responses)
   *
   * This API returns reasoning summaries when configured with reasoning.summary
   */
  private async streamWithResponsesApi(request: CompletionRequest): Promise<ReadableStream> {
    const endpoint = this.getEndpoint("/responses");
    const headers = this.getHeaders();

    // Transform messages to Responses API format
    const input = this.transformMessagesToInput(request);

    const body: Record<string, unknown> = {
      model: request.model,
      input,
      stream: true,
    };

    // Add reasoning configuration with summary enabled
    if (request.reasoning?.enabled) {
      body.reasoning = {
        effort: request.reasoning.effort || "medium",
        summary: "auto", // Enable reasoning summary in response
      };
      agentLogger.info("[OPENAI] Using Responses API with reasoning summary:", body.reasoning);
    }

    // Add max tokens if specified
    if (request.maxTokens) {
      body.max_output_tokens = request.maxTokens;
    }

    // Add tools if specified
    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools.map((tool) => ({
        type: "function",
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      }));
    }

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw toError(createError({
        type: "agent",
        message: `OpenAI Responses API error (${response.status}): ${error}`,
      }));
    }

    if (!response.body) {
      throw toError(createError({
        type: "agent",
        message: "OpenAI: No response body for streaming",
      }));
    }

    return this.transformResponsesApiStream(response.body);
  }

  /**
   * Transform messages to Responses API input format
   *
   * The Responses API uses different role names and formats:
   * - "system" -> "developer"
   * - "tool" -> "user" with function_call_output format
   * - Tool calls from assistant are handled via function_call items
   */
  private transformMessagesToInput(request: CompletionRequest): unknown[] {
    const input: unknown[] = [];

    // Add system message if present
    if (request.system) {
      input.push({
        role: "developer", // Responses API uses "developer" instead of "system"
        content: request.system,
      });
    }

    // Add conversation messages
    for (const msg of request.messages) {
      if (msg.role === "system") {
        input.push({
          role: "developer",
          content: msg.content,
        });
      } else if (msg.role === "tool") {
        // Tool results in Responses API use a different format
        // They need to be sent as function_call_output items
        // For now, skip tool messages as they require special handling
        // The agent loop will re-run the conversation from scratch
        agentLogger.debug(
          "[OPENAI] Skipping tool message for Responses API - not yet supported in multi-turn",
        );
      } else if (msg.role === "assistant") {
        // Check if this assistant message has tool calls
        if (msg.tool_calls && msg.tool_calls.length > 0) {
          // Skip assistant messages with tool calls as they need special handling
          agentLogger.debug(
            "[OPENAI] Skipping assistant tool call message for Responses API - not yet supported",
          );
        } else {
          input.push({
            role: "assistant",
            content: msg.content,
          });
        }
      } else {
        // user messages
        input.push({
          role: "user",
          content: msg.content,
        });
      }
    }

    return input;
  }

  /**
   * Transform Responses API streaming events to standard format.
   *
   * Handles these event types:
   * - response.output_text.delta -> text content
   * - response.reasoning_summary_text.delta -> reasoning summary
   * - response.function_call_arguments.delta -> tool call arguments
   * - response.completed -> finish
   */
  private transformResponsesApiStream(stream: ReadableStream): ReadableStream {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();

    // Track tool calls being accumulated
    const toolCalls = new Map<string, {
      id: string;
      name: string;
      arguments: string;
      index: number;
    }>();
    let toolCallIndex = 0;

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

                if (data === "[DONE]") {
                  continue;
                }

                try {
                  const event = JSON.parse(data);
                  const eventType = event.type;

                  // Handle text content delta
                  if (eventType === "response.output_text.delta") {
                    const contentChunk = JSON.stringify({
                      type: "content",
                      content: event.delta,
                    });
                    controller.enqueue(encoder.encode(contentChunk + "\n"));
                  }

                  // Handle reasoning summary delta
                  if (eventType === "response.reasoning_summary_text.delta") {
                    const reasoningChunk = JSON.stringify({
                      type: "reasoning",
                      content: event.delta,
                    });
                    controller.enqueue(encoder.encode(reasoningChunk + "\n"));
                  }

                  // Handle function call start (from output_item.added with function_call type)
                  if (
                    eventType === "response.output_item.added" &&
                    event.item?.type === "function_call"
                  ) {
                    const item = event.item;
                    const callId = item.call_id || item.id;
                    const index = toolCallIndex++;

                    toolCalls.set(callId, {
                      id: callId,
                      name: item.name,
                      arguments: "",
                      index,
                    });

                    const startChunk = JSON.stringify({
                      type: "tool_call_start",
                      toolCall: {
                        id: callId,
                        name: item.name,
                        index,
                      },
                    });
                    controller.enqueue(encoder.encode(startChunk + "\n"));
                  }

                  // Handle function call arguments delta
                  if (eventType === "response.function_call_arguments.delta") {
                    const callId = event.call_id || event.item_id;
                    const tc = toolCalls.get(callId);

                    if (tc) {
                      tc.arguments += event.delta;

                      const deltaChunk = JSON.stringify({
                        type: "tool_call_delta",
                        id: tc.id,
                        index: tc.index,
                        arguments: event.delta,
                      });
                      controller.enqueue(encoder.encode(deltaChunk + "\n"));
                    }
                  }

                  // Handle function call complete
                  if (eventType === "response.function_call_arguments.done") {
                    const callId = event.call_id || event.item_id;
                    const tc = toolCalls.get(callId);

                    if (tc) {
                      const completeChunk = JSON.stringify({
                        type: "tool_call_complete",
                        toolCall: {
                          id: tc.id,
                          name: tc.name,
                          index: tc.index,
                          arguments: tc.arguments,
                        },
                      });
                      controller.enqueue(encoder.encode(completeChunk + "\n"));
                    }
                  }

                  // Handle completion
                  if (eventType === "response.completed" || eventType === "response.done") {
                    // Emit any remaining tool calls
                    if (toolCalls.size > 0) {
                      const finishChunk = JSON.stringify({
                        type: "finish",
                        finishReason: "tool_calls",
                      });
                      controller.enqueue(encoder.encode(finishChunk + "\n"));
                    } else {
                      const finishChunk = JSON.stringify({
                        type: "finish",
                        finishReason: "stop",
                      });
                      controller.enqueue(encoder.encode(finishChunk + "\n"));
                    }
                  }
                } catch (e) {
                  // Skip invalid JSON
                  agentLogger.warn("Failed to parse Responses API stream chunk:", e);
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
