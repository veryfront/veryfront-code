/**
 * AI Provider schemas
 *
 * Schemas for AI provider configuration and completion API.
 */

import { z } from "zod";

/**
 * Base provider configuration
 */
export const ProviderConfigSchema = z.object({
  apiKey: z.string().optional(),
  baseURL: z.string().url().optional(),
  organizationId: z.string().optional(),
  options: z.record(z.unknown()).optional(),
});

/**
 * OpenAI provider configuration
 */
export const OpenAIConfigSchema = ProviderConfigSchema.extend({
  apiKey: z.string(),
});

/**
 * Anthropic provider configuration
 */
export const AnthropicConfigSchema = ProviderConfigSchema.extend({
  apiKey: z.string(),
});

/**
 * Google provider configuration
 */
export const GoogleConfigSchema = ProviderConfigSchema.extend({
  apiKey: z.string(),
});

/**
 * Multi-provider configuration
 */
export const ProvidersConfigSchema = z.object({
  default: z.string().optional(),
  openai: OpenAIConfigSchema.optional(),
  anthropic: AnthropicConfigSchema.optional(),
  google: GoogleConfigSchema.optional(),
});

/**
 * Tool call schema for completion messages
 */
const toolCallSchema = z.object({
  id: z.string(),
  type: z.string().optional(),
  function: z.object({
    name: z.string(),
    arguments: z.string(),
  }),
});

/**
 * Message schema for completion requests
 */
const completionMessageSchema = z.object({
  role: z.string(),
  content: z.string(),
  tool_calls: z.array(toolCallSchema).optional(),
  tool_call_id: z.string().optional(),
});

/**
 * Completion request schema
 */
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

/**
 * Tool call result in completion response
 */
const completionToolCallSchema = z.object({
  id: z.string(),
  name: z.string(),
  arguments: z.record(z.unknown()),
});

/**
 * Completion response schema
 */
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
