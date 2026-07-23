import { defineSchema, lazySchema } from "#veryfront/schemas/index.ts";
import type { InferSchema } from "#veryfront/extensions/schema/index.ts";
import { hasUnsafeControlCharacters } from "#veryfront/errors/text-validation.ts";

const MAX_API_KEY_LENGTH = 16_384;
const MAX_MODEL_ID_LENGTH = 4_096;
const MAX_TEXT_LENGTH = 16 * 1_024 * 1_024;
const MAX_MESSAGES = 1_024;
const MAX_TOOLS = 128;

function isSafeBaseUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      !parsed.username && !parsed.password && !parsed.hash;
  } catch {
    return false;
  }
}

function isSafeCredential(value: string): boolean {
  return !/\s/u.test(value) && !hasUnsafeControlCharacters(value);
}

function isSafeModelId(value: string): boolean {
  return !/\s/u.test(value) && !hasUnsafeControlCharacters(value);
}

const getApiKeySchema = defineSchema((v) =>
  v.string().min(1).max(MAX_API_KEY_LENGTH).refine(
    isSafeCredential,
    "Invalid provider credential",
  )
);

const getModelIdSchema = defineSchema((v) =>
  v.string().min(1).max(MAX_MODEL_ID_LENGTH).refine(isSafeModelId, "Invalid model ID")
);

/** Build the common provider configuration schema. */
export const getProviderConfigSchema = defineSchema((v) =>
  v.object({
    apiKey: getApiKeySchema().optional(),
    baseURL: v.string().max(2_048).url().refine(isSafeBaseUrl, "Invalid provider base URL")
      .optional(),
    organizationId: v.string().min(1).max(1_024).optional(),
    options: v.record(v.string().min(1).max(256), v.unknown()).refine(
      (options) => Object.keys(options).length <= 128,
      "Provider options contain too many entries",
    ).optional(),
  }).strict()
);

/** Build the OpenAI provider configuration schema. */
export const getOpenAIConfigSchema = defineSchema((_v) =>
  getProviderConfigSchema().extend({
    apiKey: getApiKeySchema(),
  })
);

/** Build the Anthropic provider configuration schema. */
export const getAnthropicConfigSchema = defineSchema((_v) =>
  getProviderConfigSchema().extend({
    apiKey: getApiKeySchema(),
  })
);

/** Build the Google provider configuration schema. */
export const getGoogleConfigSchema = defineSchema((_v) =>
  getProviderConfigSchema().extend({
    apiKey: getApiKeySchema(),
  })
);

/** Build the provider collection configuration schema. */
export const getProvidersConfigSchema = defineSchema((v) =>
  v.object({
    default: getModelIdSchema().optional(),
    openai: getOpenAIConfigSchema().optional(),
    anthropic: getAnthropicConfigSchema().optional(),
    google: getGoogleConfigSchema().optional(),
  }).strict()
);

const getToolCallSchema = defineSchema((v) =>
  v.object({
    id: v.string().min(1).max(1_024),
    type: v.string().optional(),
    function: v.object({
      name: v.string().min(1).max(256),
      arguments: v.string().max(MAX_TEXT_LENGTH),
    }).strict(),
  }).strict()
);

const getCompletionMessageSchema = defineSchema((v) =>
  v.object({
    role: v.enum(["system", "user", "assistant", "tool"]),
    content: v.string().max(MAX_TEXT_LENGTH),
    tool_calls: v.array(getToolCallSchema()).max(MAX_TOOLS).optional(),
    tool_call_id: v.string().min(1).max(1_024).optional(),
  }).strict()
);

/** Build the completion request schema. */
export const getCompletionRequestSchema = defineSchema((v) =>
  v.object({
    model: getModelIdSchema(),
    messages: v.array(getCompletionMessageSchema()).min(1).max(MAX_MESSAGES),
    system: v.string().max(MAX_TEXT_LENGTH).optional(),
    maxTokens: v.number().int().positive().max(1_000_000).optional(),
    temperature: v.number().min(0).max(2).optional(),
    topP: v.number().min(0).max(1).optional(),
    stream: v.boolean().optional(),
    tools: v.array(v.unknown()).max(MAX_TOOLS).optional(),
    reasoning: v
      .object({
        effort: v.enum(["low", "medium", "high"]).optional(),
      }).strict()
      .optional(),
  }).strict()
);

const getCompletionToolCallSchema = defineSchema((v) =>
  v.object({
    id: v.string().min(1).max(1_024),
    name: v.string().min(1).max(256),
    arguments: v.record(v.string().min(1).max(256), v.unknown()).refine(
      (argumentsValue) => Object.keys(argumentsValue).length <= 1_024,
      "Tool call arguments contain too many entries",
    ),
  }).strict()
);

/** Build the completion response schema. */
export const getCompletionResponseSchema = defineSchema((v) =>
  v.object({
    text: v.string().max(MAX_TEXT_LENGTH),
    toolCalls: v.array(getCompletionToolCallSchema()).max(MAX_TOOLS).optional(),
    usage: v.object({
      promptTokens: v.number().int().nonnegative(),
      completionTokens: v.number().int().nonnegative(),
      totalTokens: v.number().int().nonnegative(),
    }).strict(),
    finishReason: v.enum(["stop", "length", "tool_calls", "content_filter"]),
  }).strict()
);

// Inferred types
export type ProviderConfig = InferSchema<ReturnType<typeof getProviderConfigSchema>>;
export type OpenAIConfig = InferSchema<ReturnType<typeof getOpenAIConfigSchema>>;
export type AnthropicConfig = InferSchema<ReturnType<typeof getAnthropicConfigSchema>>;
export type GoogleConfig = InferSchema<ReturnType<typeof getGoogleConfigSchema>>;
export type ProvidersConfig = InferSchema<ReturnType<typeof getProvidersConfigSchema>>;
export type CompletionRequest = InferSchema<ReturnType<typeof getCompletionRequestSchema>>;
export type CompletionResponse = InferSchema<ReturnType<typeof getCompletionResponseSchema>>;

/** Lazy common provider configuration schema. */
export const ProviderConfigSchema = lazySchema(getProviderConfigSchema);
/** Lazy OpenAI provider configuration schema. */
export const OpenAIConfigSchema = lazySchema(getOpenAIConfigSchema);
/** Lazy Anthropic provider configuration schema. */
export const AnthropicConfigSchema = lazySchema(getAnthropicConfigSchema);
/** Lazy Google provider configuration schema. */
export const GoogleConfigSchema = lazySchema(getGoogleConfigSchema);
/** Lazy provider collection configuration schema. */
export const ProvidersConfigSchema = lazySchema(getProvidersConfigSchema);
/** Lazy completion request schema. */
export const CompletionRequestSchema = lazySchema(getCompletionRequestSchema);
/** Lazy completion response schema. */
export const CompletionResponseSchema = lazySchema(getCompletionResponseSchema);
