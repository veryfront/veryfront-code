/** OpenAI provider implementation */

import { z } from "zod";
import { BaseProvider, mapFinishReason } from "./base.ts";
import { createError, toError } from "../../core/errors/veryfront-error.ts";
import type { CompletionRequest, CompletionResponse, OpenAIConfig } from "../types/provider.ts";

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

    if (request.maxTokens) {
      body.max_tokens = request.maxTokens;
    }

    if (request.temperature !== undefined) {
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
      body.parallel_tool_calls = false;
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
      finishReason: mapFinishReason(choice.finish_reason),
    };
  }
}
