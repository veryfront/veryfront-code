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

import { BaseProvider, mapFinishReason } from "./base.ts";
import type { CompletionRequest, CompletionResponse, OpenAIConfig } from "../types/provider.ts";
import { createError, toError } from "../../core/errors/veryfront-error.ts";

/**
 * Check if a model is an o-series reasoning model (o1, o3, etc.)
 * These models have different API parameter requirements.
 */
function isOSeriesModel(model: string): boolean {
  return model.startsWith("o1") || model.startsWith("o3");
}

export class OpenAIProvider extends BaseProvider {
  name = "openai";

  constructor(config: OpenAIConfig) {
    super(config);
  }

  protected getHeaders(): Record<string, string> {
    const config = this.config as OpenAIConfig;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${config.apiKey}`,
    };

    if (config.organizationId) {
      headers["OpenAI-Organization"] = config.organizationId;
    }

    return headers;
  }

  protected getEndpoint(path: string): string {
    const config = this.config as OpenAIConfig;
    const baseURL = config.baseURL || "https://api.openai.com/v1";
    return `${baseURL}${path}`;
  }

  protected transformRequest(request: CompletionRequest): Record<string, unknown> {
    const model = request.model;
    const isReasoning = isOSeriesModel(model);

    // Base request body
    const body: Record<string, unknown> = {
      model,
      messages: this.formatMessages(request.messages, request.system),
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

    // Top P
    if (!isReasoning && request.topP !== undefined) {
      body.top_p = request.topP;
    }

    // Tools - o-series doesn't support parallel_tool_calls
    if (request.tools?.length) {
      body.tools = request.tools.map((tool) => ({
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      }));

      // Only add parallel_tool_calls for non-reasoning models
      if (!isReasoning) {
        body.parallel_tool_calls = false;
      }
    }

    // Reasoning effort - only for o-series models
    if (isReasoning && request.reasoning?.effort) {
      body.reasoning_effort = request.reasoning.effort;
    }

    return body;
  }

  protected transformResponse(response: unknown): CompletionResponse {
    // Basic validation to prevent crashes on malformed responses
    if (!response || typeof response !== "object") {
      throw toError(createError({
        type: "agent",
        message: "OpenAI: Invalid response format - expected object",
      }));
    }

    const data = response as {
      choices?: Array<{
        message?: {
          role: string;
          content: string | null;
          tool_calls?: Array<{
            id: string;
            type: string;
            function: {
              name: string;
              arguments: string;
            };
          }>;
        };
        finish_reason: string | null;
      }>;
      usage?: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
      };
    };

    if (!data.choices || !Array.isArray(data.choices) || data.choices.length === 0) {
      throw toError(createError({
        type: "agent",
        message: "OpenAI: Response missing choices array",
      }));
    }

    const choice = data.choices[0];
    if (!choice || !choice.message) {
      throw toError(createError({
        type: "agent",
        message: "OpenAI: Invalid choice or missing message in response",
      }));
    }

    // Extract tool calls if present, with error handling for JSON parsing
    const toolCalls = choice.message.tool_calls?.map((tc) => {
      try {
        return {
          id: tc.id,
          name: tc.function.name,
          arguments: JSON.parse(tc.function.arguments) as Record<string, unknown>,
        };
      } catch (error) {
        throw toError(createError({
          type: "agent",
          message: `OpenAI: Invalid tool call arguments JSON for ${tc.function.name}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        }));
      }
    });

    return {
      text: choice.message.content || "",
      toolCalls,
      usage: {
        promptTokens: data.usage?.prompt_tokens ?? 0,
        completionTokens: data.usage?.completion_tokens ?? 0,
        totalTokens: data.usage?.total_tokens ?? 0,
      },
      finishReason: mapFinishReason(choice.finish_reason ?? "stop"),
    };
  }

  private formatMessages(
    messages: CompletionRequest["messages"],
    system?: string,
  ) {
    const formattedMessages = messages.map((msg) => {
      // Handle tool results
      if (msg.tool_call_id) {
        return {
          role: "tool",
          tool_call_id: msg.tool_call_id,
          content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content),
        };
      }

      // Handle assistant messages with tool calls
      if (msg.role === "assistant" && msg.tool_calls) {
        return {
          role: "assistant",
          content: msg.content || null,
          tool_calls: msg.tool_calls.map((tc) => ({
            id: tc.id,
            type: tc.type || "function",
            function: {
              name: tc.function.name,
              arguments: tc.function.arguments,
            },
          })),
        };
      }

      return {
        role: msg.role,
        content: msg.content,
      };
    });

    // Prepend system message if provided
    if (system) {
      return [
        { role: "system", content: system },
        ...formattedMessages,
      ];
    }

    return formattedMessages;
  }
}
