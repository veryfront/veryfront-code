import { createError, toError } from "../../core/errors/veryfront-error.ts";
import type {
  CompletionRequest,
  CompletionResponse,
  Provider,
  ProviderConfig,
} from "../types/provider.ts";
import { agentLogger } from "../../core/utils/logger/logger.ts";
import { z } from "zod";

const FINISH_REASON_MAP: Record<string, CompletionResponse["finishReason"]> = {
  stop: "stop",
  length: "length",
  max_tokens: "length",
  tool_calls: "tool_calls",
  function_call: "tool_calls",
  content_filter: "content_filter",
} as const;

export function mapFinishReason(reason: string): CompletionResponse["finishReason"] {
  return FINISH_REASON_MAP[reason] ?? "stop";
}

const OpenAIStreamChunkSchema = z.object({
  choices: z.array(z.object({
    delta: z.object({
      content: z.string().optional().nullable(),
      tool_calls: z.array(z.object({
        index: z.number().optional(),
        id: z.string().optional(),
        function: z.object({
          name: z.string().optional(),
          arguments: z.string().optional(),
        }).optional(),
      })).optional(),
    }),
    finish_reason: z.string().nullable(),
  })).min(1),
});

const OpenAICompletionResponseSchema = z.object({
  id: z.string(),
  choices: z.array(z.object({
    message: z.object({
      role: z.string(),
      content: z.string().nullable().optional(),
      tool_calls: z.array(z.object({
        id: z.string(),
        type: z.literal("function"),
        function: z.object({
          name: z.string(),
          arguments: z.string(),
        }),
      })).optional(),
    }),
    finish_reason: z.string().nullable(),
  })).min(1),
  usage: z.object({
    prompt_tokens: z.number(),
    completion_tokens: z.number(),
    total_tokens: z.number(),
  }).optional(),
});

export abstract class BaseProvider implements Provider {
  abstract name: string;
  protected config: ProviderConfig;

  constructor(config: ProviderConfig) {
    this.config = config;
    this.validateConfig();
  }

  protected validateConfig(): void {
    if (!this.config.apiKey) {
      throw toError(createError({
        type: "agent",
        message: `${this.name}: API key is required`,
      }));
    }
  }

  protected abstract getHeaders(): Record<string, string>;
  protected abstract getEndpoint(path: string): string;
  protected abstract transformRequest(request: CompletionRequest): Record<string, unknown>;
  protected abstract transformResponse(response: unknown): CompletionResponse;

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const endpoint = this.getEndpoint("/chat/completions");
    const headers = this.getHeaders();
    const body = this.transformRequest({ ...request, stream: false });

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
        message: `${this.name} API error (${response.status}): ${error}`,
      }));
    }

    const data = await response.json();

    // Validate response structure
    const parseResult = OpenAICompletionResponseSchema.safeParse(data);
    if (!parseResult.success) {
      agentLogger.warn(`${this.name}: Invalid response structure`, {
        errors: parseResult.error.flatten(),
      });
      throw toError(createError({
        type: "agent",
        message: `${this.name}: Invalid response structure from provider`,
      }));
    }

    return this.transformResponse(parseResult.data);
  }

  async stream(request: CompletionRequest): Promise<ReadableStream> {
    const endpoint = this.getEndpoint("/chat/completions");
    const headers = this.getHeaders();
    const body = this.transformRequest({ ...request, stream: true });

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
        message: `${this.name} API error (${response.status}): ${error}`,
      }));
    }

    if (!response.body) {
      throw toError(createError({
        type: "agent",
        message: `${this.name}: No response body for streaming`,
      }));
    }

    return this.transformStream(response.body);
  }

  protected transformStream(stream: ReadableStream): ReadableStream {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();

    // Track tool calls being accumulated
    const toolCalls = new Map<number, {
      id?: string;
      name?: string;
      arguments: string;
    }>();

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
                  const raw = JSON.parse(data);
                  const result = OpenAIStreamChunkSchema.safeParse(raw);

                  if (!result.success) {
                    // agentLogger.debug("Skipping invalid stream chunk schema", result.error);
                    continue;
                  }

                  const choice = result.data.choices[0];

                  if (!choice) continue;

                  const delta = choice.delta;
                  const finishReason = choice.finish_reason;

                  // Handle text content
                  if (delta?.content) {
                    const contentChunk = JSON.stringify({
                      type: "content",
                      content: delta.content,
                    });
                    controller.enqueue(encoder.encode(contentChunk + "\n"));
                  }

                  // Handle tool calls
                  if (delta?.tool_calls) {
                    for (const toolCall of delta.tool_calls) {
                      const index = toolCall.index ?? 0;

                      if (!toolCalls.has(index)) {
                        toolCalls.set(index, { arguments: "" });
                      }

                      const tc = toolCalls.get(index)!;

                      // Tool call start (has id and name)
                      if (toolCall.id) {
                        tc.id = toolCall.id;
                      }

                      if (toolCall.function?.name) {
                        tc.name = toolCall.function.name;

                        // Emit tool call start event
                        const startChunk = JSON.stringify({
                          type: "tool_call_start",
                          toolCall: {
                            id: tc.id,
                            name: tc.name,
                            index,
                          },
                        });
                        controller.enqueue(encoder.encode(startChunk + "\n"));
                      }

                      // Accumulate arguments
                      if (toolCall.function?.arguments) {
                        tc.arguments += toolCall.function.arguments;

                        // Emit delta event
                        const deltaChunk = JSON.stringify({
                          type: "tool_call_delta",
                          id: tc.id,
                          index,
                          arguments: toolCall.function.arguments,
                        });
                        controller.enqueue(encoder.encode(deltaChunk + "\n"));
                      }
                    }
                  }

                  // Handle finish reason
                  if (finishReason) {
                    // Emit complete tool calls
                    if (finishReason === "tool_calls" || finishReason === "function_call") {
                      for (const [index, tc] of toolCalls.entries()) {
                        const completeChunk = JSON.stringify({
                          type: "tool_call_complete",
                          toolCall: {
                            id: tc.id!,
                            name: tc.name!,
                            index,
                            arguments: tc.arguments,
                          },
                        });
                        controller.enqueue(encoder.encode(completeChunk + "\n"));
                      }
                    }

                    // Emit finish event
                    const finishChunk = JSON.stringify({
                      type: "finish",
                      finishReason,
                    });
                    controller.enqueue(encoder.encode(finishChunk + "\n"));
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
