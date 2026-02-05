import { z } from "zod";

export const embeddingDimensionSchema = z.union([
  z.literal(768),
  z.literal(1024),
  z.literal(1536),
  z.literal(3072),
  z.literal(4096),
]);

export const EmbeddingProviderConfigSchema = z.object({
  apiKey: z.string().optional(),
  baseURL: z.string().url().optional(),
  model: z.string().optional(),
  dimension: embeddingDimensionSchema.optional(),
  batchSize: z.number().int().positive().optional(),
});

export const EmbeddingRequestSchema = z.object({
  inputs: z.array(z.string().min(1)),
  model: z.string().optional(),
  dimension: embeddingDimensionSchema.optional(),
});

export const EmbeddingResultSchema = z.object({
  index: z.number().int().nonnegative(),
  embedding: z.array(z.number()),
});

export const EmbeddingUsageSchema = z.object({
  promptTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
});

export const EmbeddingResponseSchema = z.object({
  embeddings: z.array(EmbeddingResultSchema),
  model: z.string(),
  dimension: z.number().int().positive(),
  usage: EmbeddingUsageSchema.optional(),
});

// Inferred types
export type EmbeddingDimension = z.infer<typeof embeddingDimensionSchema>;
export type EmbeddingProviderConfig = z.infer<typeof EmbeddingProviderConfigSchema>;
export type EmbeddingRequest = z.infer<typeof EmbeddingRequestSchema>;
export type EmbeddingResult = z.infer<typeof EmbeddingResultSchema>;
export type EmbeddingUsage = z.infer<typeof EmbeddingUsageSchema>;
export type EmbeddingResponse = z.infer<typeof EmbeddingResponseSchema>;
