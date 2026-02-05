import { z } from "zod";

export const ProviderConfigSchema = z.object({
  apiKey: z.string().optional(),
  baseURL: z.string().url().optional(),
  organizationId: z.string().optional(),
  options: z.record(z.unknown()).optional(),
});

export const OpenAIConfigSchema = ProviderConfigSchema.extend({
  apiKey: z.string(),
});

export const AnthropicConfigSchema = ProviderConfigSchema.extend({
  apiKey: z.string(),
});

export const GoogleConfigSchema = ProviderConfigSchema.extend({
  apiKey: z.string(),
});

export const ProvidersConfigSchema = z.object({
  default: z.string().optional(),
  openai: OpenAIConfigSchema.optional(),
  anthropic: AnthropicConfigSchema.optional(),
  google: GoogleConfigSchema.optional(),
});

const toolCallSchema = z.object({
  id: z.string(),
  type: z.string().optional(),
  function: z.object({
    name: z.string(),
    arguments: z.string(),
  }),
});

const completionMessageSchema = z.object({
  role: z.string(),
  content: z.string(),
  tool_calls: z.array(toolCallSchema).optional(),
  tool_call_id: z.string().optional(),
});

export const CompletionRequestSchema = z.object({
  model: z.string(),
  messages: z.array(completionMessageSchema),
  system: z.string().optional(),
  maxTokens: z.number().int().positive().optional(),
  temperature: z.number().min(0).max(2).optional(),
  topP: z.number().min(0).max(1).optional(),
  stream: z.boolean().optional(),
  tools: z.array(z.any()).optional(), // ToolDefinition is complex
  reasoning: z
    .object({
      effort: z.enum(["low", "medium", "high"]).optional(),
    })
    .optional(),
});

const completionToolCallSchema = z.object({
  id: z.string(),
  name: z.string(),
  arguments: z.record(z.unknown()),
});

export const CompletionResponseSchema = z.object({
  text: z.string(),
  toolCalls: z.array(completionToolCallSchema).optional(),
  usage: z.object({
    promptTokens: z.number().int().nonnegative(),
    completionTokens: z.number().int().nonnegative(),
    totalTokens: z.number().int().nonnegative(),
  }),
  finishReason: z.enum(["stop", "length", "tool_calls", "content_filter"]),
});

// Inferred types
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;
export type OpenAIConfig = z.infer<typeof OpenAIConfigSchema>;
export type AnthropicConfig = z.infer<typeof AnthropicConfigSchema>;
export type GoogleConfig = z.infer<typeof GoogleConfigSchema>;
export type ProvidersConfig = z.infer<typeof ProvidersConfigSchema>;
export type CompletionRequest = z.infer<typeof CompletionRequestSchema>;
export type CompletionResponse = z.infer<typeof CompletionResponseSchema>;
