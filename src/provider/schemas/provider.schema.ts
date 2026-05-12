import { defineSchema } from "#veryfront/schemas/index.ts";
import type { InferSchema } from "#veryfront/extensions/schema/index.ts";

export const getProviderConfigSchema = defineSchema((v) =>
  v.object({
    apiKey: v.string().optional(),
    baseURL: v.string().url().optional(),
    organizationId: v.string().optional(),
    options: v.record(v.string(), v.unknown()).optional(),
  })
);

export const getOpenAIConfigSchema = defineSchema((v) =>
  getProviderConfigSchema().extend({
    apiKey: v.string(),
  })
);

export const getAnthropicConfigSchema = defineSchema((v) =>
  getProviderConfigSchema().extend({
    apiKey: v.string(),
  })
);

export const getGoogleConfigSchema = defineSchema((v) =>
  getProviderConfigSchema().extend({
    apiKey: v.string(),
  })
);

export const getProvidersConfigSchema = defineSchema((v) =>
  v.object({
    default: v.string().optional(),
    openai: getOpenAIConfigSchema().optional(),
    anthropic: getAnthropicConfigSchema().optional(),
    google: getGoogleConfigSchema().optional(),
  })
);

const getToolCallSchema = defineSchema((v) =>
  v.object({
    id: v.string(),
    type: v.string().optional(),
    function: v.object({
      name: v.string(),
      arguments: v.string(),
    }),
  })
);

const getCompletionMessageSchema = defineSchema((v) =>
  v.object({
    role: v.string(),
    content: v.string(),
    tool_calls: v.array(getToolCallSchema()).optional(),
    tool_call_id: v.string().optional(),
  })
);

export const getCompletionRequestSchema = defineSchema((v) =>
  v.object({
    model: v.string(),
    messages: v.array(getCompletionMessageSchema()),
    system: v.string().optional(),
    maxTokens: v.number().int().positive().optional(),
    temperature: v.number().min(0).max(2).optional(),
    topP: v.number().min(0).max(1).optional(),
    stream: v.boolean().optional(),
    // deno-lint-ignore no-explicit-any -- ToolDefinition shapes vary across providers
    tools: v.array(v.any()).optional(),
    reasoning: v
      .object({
        effort: v.enum(["low", "medium", "high"]).optional(),
      })
      .optional(),
  })
);

const getCompletionToolCallSchema = defineSchema((v) =>
  v.object({
    id: v.string(),
    name: v.string(),
    arguments: v.record(v.string(), v.unknown()),
  })
);

export const getCompletionResponseSchema = defineSchema((v) =>
  v.object({
    text: v.string(),
    toolCalls: v.array(getCompletionToolCallSchema()).optional(),
    usage: v.object({
      promptTokens: v.number().int().nonnegative(),
      completionTokens: v.number().int().nonnegative(),
      totalTokens: v.number().int().nonnegative(),
    }),
    finishReason: v.enum(["stop", "length", "tool_calls", "content_filter"]),
  })
);

// Inferred types
export type ProviderConfig = InferSchema<ReturnType<typeof getProviderConfigSchema>>;
export type OpenAIConfig = InferSchema<ReturnType<typeof getOpenAIConfigSchema>>;
export type AnthropicConfig = InferSchema<ReturnType<typeof getAnthropicConfigSchema>>;
export type GoogleConfig = InferSchema<ReturnType<typeof getGoogleConfigSchema>>;
export type ProvidersConfig = InferSchema<ReturnType<typeof getProvidersConfigSchema>>;
export type CompletionRequest = InferSchema<ReturnType<typeof getCompletionRequestSchema>>;
export type CompletionResponse = InferSchema<ReturnType<typeof getCompletionResponseSchema>>;

// Backward compat aliases
export const ProviderConfigSchema = getProviderConfigSchema();
export const OpenAIConfigSchema = getOpenAIConfigSchema();
export const AnthropicConfigSchema = getAnthropicConfigSchema();
export const GoogleConfigSchema = getGoogleConfigSchema();
export const ProvidersConfigSchema = getProvidersConfigSchema();
export const CompletionRequestSchema = getCompletionRequestSchema();
export const CompletionResponseSchema = getCompletionResponseSchema();
