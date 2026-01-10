/**
 * OpenAI provider implementation
 *
 * Supports both standard models and o-series reasoning models (o1, o3).
 * O-series models have different parameter requirements:
 * - Use max_completion_tokens instead of max_tokens
 * - Don't support temperature parameter
 * - Don't support parallel_tool_calls
 * - Support reasoning_effort parameter
 */

import { z } from "zod";

/**
 * Check if a model is an o-series reasoning model (o1, o3, etc.)
 * These models have different API parameter requirements.
 */
function isOSeriesModel(model: string): boolean {
  return model.startsWith("o1") || model.startsWith("o3");
}

import { BaseProvider } from "./base.ts";
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
  private baseUrl: string;
  private defaultModel: string;
  private organization?: string;

  constructor(config: OpenAIConfig) {
    super();
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || "https://api.openai.com/v1";
    this.defaultModel = config.defaultModel || "gpt-4o";
    this.organization = config.organization;
  }

  /**
   * Build the request body for OpenAI API
   * Handles o-series models differently than standard models
   */
  private buildRequestBody(request: CompletionRequest): Record<string, unknown> {
    const model = request.model || this.defaultModel;
    const isReasoning = isOSeriesModel(model);

    // Base request body
    const body: Record<string, unknown> = {
      model,
      messages: this.formatMessages(request.messages),
      stream: request.stream || false,
    };

    // Handle max tokens - o-series uses max_completion_tokens
    if (request.maxTokens) {
      if (isReasoning) {
        body.max_completion_tokens = request.maxTokens;
      } else {
        body.max_tokens = request.maxTokens;
      }
    }

    // Temperature - not supported by o-series models
    if (!isReasoning && request.temperature !== undefined) {
      body.temperature = request.temperature;
    }

    // Stop sequences
    if (request.stopSequences?.length) {
      body.stop = request.stopSequences;
    }

    // Tools - o-series doesn't support parallel_tool_calls
    if (request.tools?.length) {
      body.tools = request.tools.map((tool) => ({
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema,
        },
      }));

      // Only add parallel_tool_calls for non-reasoning models
      if (!isReasoning) {
        body.parallel_tool_calls = false;
      }
    }

    // Reasoning effort - only for o-series models
    if (isReasoning && request.reasoningEffort) {
      body.reasoning_effort = request.reasoningEffort;
    }

    return body;
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const body = this.buildRequestBody(request);

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${this.apiKey}`,
    };

    if (this.organization) {
      headers["OpenAI-Organization"] = this.organization;
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw toError(
        createError({
          type: "provider",
          message: `OpenAI API error: ${response.status} ${response.statusText}`,
          context: { body: errorBody },
        }),
      );
    }

    const data = await response.json();
    const parsed = OpenAIResponseSchema.parse(data);
    const choice = parsed.choices[0];

    // Extract tool calls if present
    const toolCalls = choice.message.tool_calls?.map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: JSON.parse(tc.function.arguments),
    }));

    return {
      content: choice.message.content || "",
      toolCalls,
      usage: parsed.usage ? {
        promptTokens: parsed.usage.prompt_tokens,
        completionTokens: parsed.usage.completion_tokens,
        totalTokens: parsed.usage.total_tokens,
      } : undefined,
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
        return "tool_use";
      case "content_filter":
        return "content_filter";
      default:
        return "stop";
    }
  }

  private formatMessages(messages: CompletionRequest["messages"]) {
    return messages.map((msg) => {
      if (msg.role === "tool") {
        return {
          role: "tool",
          tool_call_id: msg.toolCallId,
          content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content),
        };
      }

      if (msg.role === "assistant" && msg.toolCalls) {
        return {
          role: "assistant",
          content: msg.content || null,
          tool_calls: msg.toolCalls.map((tc) => ({
            id: tc.id,
            type: "function",
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.arguments),
            },
          })),
        };
      }

      return {
        role: msg.role,
        content: msg.content,
      };
    });
  }

  async *stream(
    _request: CompletionRequest,
  ): AsyncGenerator<CompletionResponse, void, unknown> {
    throw toError(
      createError({
        type: "provider",
        message: "Streaming not yet implemented for OpenAI provider",
      }),
    );
  }
}
