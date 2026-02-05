import { z } from "zod";

export const cachePolicySchema = z.enum(["no-cache", "cache", "cache-first"]);

export const McpConfigSchema = z.object({
  enabled: z.boolean().optional(),
  cachePolicy: cachePolicySchema.optional(),
});

// Inferred types
export type CachePolicy = z.infer<typeof cachePolicySchema>;
export type McpConfig = z.infer<typeof McpConfigSchema>;
