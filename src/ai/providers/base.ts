
import { createError, toError } from "../../core/errors/veryfront-error.ts";
import type {
  CompletionRequest,
  CompletionResponse,
  Provider,
  ProviderConfig,
} from "../types/provider.ts";
import { agentLogger } from "../../core/utils/logger/logger.ts";
import { z } from "zod";

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

  protected abstract transformRequest(
    request: CompletionRequest,
  ): Record<string, unknown>;

  protected abstract transformResponse(
    response: unknown,
  ): CompletionResponse;

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
    return this.transformResponse(data);
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
                    continue;
                  }

                  const choice = result.data.choices[0];

                  if (!choice) continue;

                  const delta = choice.delta;
                  const finishReason = choice.finish_reason;

                  if (delta?.content) {
                    const contentChunk = JSON.stringify({
                      type: "content",
                      content: delta.content,
                    });
                    controller.enqueue(encoder.encode(contentChunk + "\n"));
                  }

                  if (delta?.tool_calls) {
                    for (const toolCall of delta.tool_calls) {
                      const index = toolCall.index ?? 0;

                      if (!toolCalls.has(index)) {
                        toolCalls.set(index, { arguments: "" });
                      }

                      const tc = toolCalls.get(index)!;

                      if (toolCall.id) {
                        tc.id = toolCall.id;
                      }

                      if (toolCall.function?.name) {
                        tc.name = toolCall.function.name;

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

                      if (toolCall.function?.arguments) {
                        tc.arguments += toolCall.function.arguments;

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

                  if (finishReason) {
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

                    const finishChunk = JSON.stringify({
                      type: "finish",
                      finishReason,
                    });
                    controller.enqueue(encoder.encode(finishChunk + "\n"));
                  }
                } catch (e) {
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
