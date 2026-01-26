import * as dntShim from "../../_dnt.shims.js";
import { createError, toError } from "../errors/veryfront-error.js";
import { agentLogger } from "../utils/logger/logger.js";
import { z } from "zod";
import type { CompletionRequest, CompletionResponse, Provider, ProviderConfig } from "./types.js";

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
  choices: z
    .array(
      z.object({
        delta: z.object({
          content: z.string().optional().nullable(),
          tool_calls: z
            .array(
              z.object({
                index: z.number().optional(),
                id: z.string().optional(),
                function: z
                  .object({
                    name: z.string().optional(),
                    arguments: z.string().optional(),
                  })
                  .optional(),
              }),
            )
            .optional(),
        }),
        finish_reason: z.string().nullable(),
      }),
    )
    .min(1),
});

const OpenAICompletionResponseSchema = z.object({
  id: z.string(),
  choices: z
    .array(
      z.object({
        message: z.object({
          role: z.string(),
          content: z.string().nullable().optional(),
          tool_calls: z
            .array(
              z.object({
                id: z.string(),
                type: z.literal("function"),
                function: z.object({
                  name: z.string(),
                  arguments: z.string(),
                }),
              }),
            )
            .optional(),
        }),
        finish_reason: z.string().nullable(),
      }),
    )
    .min(1),
  usage: z
    .object({
      prompt_tokens: z.number(),
      completion_tokens: z.number(),
      total_tokens: z.number(),
    })
    .optional(),
});

export abstract class BaseProvider implements Provider {
  abstract name: string;
  protected config: ProviderConfig;

  constructor(config: ProviderConfig) {
    this.config = config;
    this.validateConfig();
  }

  protected validateConfig(): void {
    if (this.config.apiKey) return;

    throw toError(
      createError({
        type: "agent",
        message: `${this.name}: API key is required`,
      }),
    );
  }

  protected abstract getHeaders(): Record<string, string>;
  protected abstract getEndpoint(path: string): string;
  protected abstract transformRequest(request: CompletionRequest): Record<string, unknown>;
  protected abstract transformResponse(response: unknown): CompletionResponse;

  private async postChatCompletions(body: Record<string, unknown>): Promise<dntShim.Response> {
    const response = await dntShim.fetch(this.getEndpoint("/chat/completions"), {
      method: "POST",
      headers: {
        ...this.getHeaders(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (response.ok) return response;

    const error = await response.text();
    throw toError(
      createError({
        type: "agent",
        message: `${this.name} API error (${response.status}): ${error}`,
      }),
    );
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const response = await this.postChatCompletions(
      this.transformRequest({ ...request, stream: false }),
    );
    const data = await response.json();

    const parseResult = OpenAICompletionResponseSchema.safeParse(data);
    if (!parseResult.success) {
      agentLogger.warn(`${this.name}: Invalid response structure`, {
        errors: parseResult.error.flatten(),
      });
      throw toError(
        createError({
          type: "agent",
          message: `${this.name}: Invalid response structure from provider`,
        }),
      );
    }

    return this.transformResponse(parseResult.data);
  }

  async stream(request: CompletionRequest): Promise<ReadableStream<Uint8Array>> {
    const response = await this.postChatCompletions(
      this.transformRequest({ ...request, stream: true }),
    );

    if (response.body) return this.transformStream(response.body);

    throw toError(
      createError({
        type: "agent",
        message: `${this.name}: No response body for streaming`,
      }),
    );
  }

  protected transformStream(stream: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();

    const toolCalls = new Map<
      number,
      {
        id?: string;
        name?: string;
        arguments: string;
      }
    >();

    return new ReadableStream<Uint8Array>({
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
              if (data === "[DONE]") continue;

              try {
                const raw = JSON.parse(data);
                const result = OpenAIStreamChunkSchema.safeParse(raw);
                if (!result.success) continue;

                const choice = result.data.choices[0];
                if (!choice) continue;

                const { delta, finish_reason: finishReason } = choice;

                if (delta.content) {
                  controller.enqueue(
                    encoder.encode(
                      JSON.stringify({
                        type: "content",
                        content: delta.content,
                      }) + "\n",
                    ),
                  );
                }

                if (delta.tool_calls) {
                  for (const toolCall of delta.tool_calls) {
                    const index = toolCall.index ?? 0;
                    const tc = toolCalls.get(index) ?? { arguments: "" };
                    toolCalls.set(index, tc);

                    if (toolCall.id) tc.id = toolCall.id;

                    const toolName = toolCall.function?.name;
                    if (toolName) {
                      tc.name = toolName;
                      controller.enqueue(
                        encoder.encode(
                          JSON.stringify({
                            type: "tool_call_start",
                            toolCall: {
                              id: tc.id,
                              name: tc.name,
                              index,
                            },
                          }) + "\n",
                        ),
                      );
                    }

                    const argsDelta = toolCall.function?.arguments;
                    if (argsDelta) {
                      tc.arguments += argsDelta;
                      controller.enqueue(
                        encoder.encode(
                          JSON.stringify({
                            type: "tool_call_delta",
                            id: tc.id,
                            index,
                            arguments: argsDelta,
                          }) + "\n",
                        ),
                      );
                    }
                  }
                }

                if (!finishReason) continue;

                if (finishReason === "tool_calls" || finishReason === "function_call") {
                  for (const [index, tc] of toolCalls.entries()) {
                    controller.enqueue(
                      encoder.encode(
                        JSON.stringify({
                          type: "tool_call_complete",
                          toolCall: {
                            id: tc.id!,
                            name: tc.name!,
                            index,
                            arguments: tc.arguments,
                          },
                        }) + "\n",
                      ),
                    );
                  }
                }

                controller.enqueue(
                  encoder.encode(
                    JSON.stringify({
                      type: "finish",
                      finishReason,
                    }) + "\n",
                  ),
                );
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
