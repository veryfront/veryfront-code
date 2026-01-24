/**** Google AI provider implementation */

import { z } from "zod";
import { BaseProvider, mapFinishReason } from "./base.ts";
import { createError, toError } from "#veryfront/errors/veryfront-error.ts";
import type { CompletionRequest, CompletionResponse, GoogleConfig } from "./types.ts";

const GoogleToolCallSchema = z.object({
  id: z.string(),
  function: z.object({
    name: z.string(),
    arguments: z.union([z.string(), z.record(z.unknown())]),
  }),
});

const GoogleResponseSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string().nullable().optional(),
          tool_calls: z.array(GoogleToolCallSchema).optional(),
        }),
        finish_reason: z.string(),
      }),
    )
    .min(1),
  usage: z
    .object({
      prompt_tokens: z.number().optional(),
      completion_tokens: z.number().optional(),
      total_tokens: z.number().optional(),
    })
    .optional(),
});

export class GoogleProvider extends BaseProvider {
  name = "google";
  private apiKey: string;
  private baseURL: string;

  constructor(config: GoogleConfig) {
    super(config);
    this.apiKey = config.apiKey;
    this.baseURL = config.baseURL ?? "https://generativelanguage.googleapis.com/v1beta";
  }

  protected getHeaders(): Record<string, string> {
    return { "x-goog-api-key": this.apiKey };
  }

  protected getEndpoint(_path: string): string {
    return `${this.baseURL}/chat/completions`;
  }

  protected transformRequest(request: CompletionRequest): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: request.model,
      messages: request.messages,
      stream: request.stream ?? false,
    };

    if (request.system) body.system = request.system;
    if (request.maxTokens) body.max_tokens = request.maxTokens;
    if (request.temperature !== undefined) body.temperature = request.temperature;
    if (request.topP !== undefined) body.top_p = request.topP;

    if (request.tools?.length) {
      body.tools = request.tools.map((tool) => ({
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      }));
    }

    return body;
  }

  protected transformResponse(response: unknown): CompletionResponse {
    const parsed = GoogleResponseSchema.safeParse(response);

    if (!parsed.success) {
      throw toError(
        createError({
          type: "agent",
          message: `Google: Invalid response format: ${parsed.error.message}`,
        }),
      );
    }

    const choice = parsed.data.choices[0];
    if (!choice) {
      throw toError(
        createError({
          type: "agent",
          message: "Google: No choices in response (unexpected)",
        }),
      );
    }

    const { message } = choice;
    const usage = parsed.data.usage;

    return {
      text: message.content ?? "",
      toolCalls: message.tool_calls?.map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: typeof tc.function.arguments === "string"
          ? JSON.parse(tc.function.arguments)
          : tc.function.arguments,
      })),
      usage: {
        promptTokens: usage?.prompt_tokens ?? 0,
        completionTokens: usage?.completion_tokens ?? 0,
        totalTokens: usage?.total_tokens ?? 0,
      },
      finishReason: mapFinishReason(choice.finish_reason),
    };
  }
}
