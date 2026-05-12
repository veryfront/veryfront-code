import { defineSchema } from "#veryfront/schemas/index.ts";
import type { InferSchema } from "#veryfront/extensions/schema/index.ts";

export const getCachePolicySchema = defineSchema((v) =>
  v.enum(["no-cache", "cache", "cache-first"] as const)
);

export const getMcpConfigSchema = defineSchema((v) =>
  v.object({
    enabled: v.boolean().optional(),
    cachePolicy: getCachePolicySchema().optional(),
  })
);

// Backward-compat aliases
export const cachePolicySchema = getCachePolicySchema();
export const McpConfigSchema = getMcpConfigSchema();

// Inferred types
export type CachePolicy = InferSchema<ReturnType<typeof getCachePolicySchema>>;
export type McpConfig = InferSchema<ReturnType<typeof getMcpConfigSchema>>;
