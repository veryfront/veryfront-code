/**
 * Resource schemas
 *
 * Schemas for MCP resource configuration and policies.
 */

import { z } from "zod";

/**
 * Cache policy schema
 */
export const cachePolicySchema = z.enum(["no-cache", "cache", "cache-first"]);

/**
 * MCP configuration schema
 */
export const McpConfigSchema = z.object({
  enabled: z.boolean().optional(),
  cachePolicy: cachePolicySchema.optional(),
});

// Inferred types
export type CachePolicy = z.infer<typeof cachePolicySchema>;
export type McpConfig = z.infer<typeof McpConfigSchema>;
