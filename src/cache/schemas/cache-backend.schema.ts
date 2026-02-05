/**
 * Cache backend schemas
 *
 * Schemas for cache backend configuration.
 */

import { z } from "zod";

/**
 * Cache backend type schema
 */
export const CacheBackendTypeSchema = z.enum(["memory", "redis", "api"]);

/**
 * Cache set batch entry schema
 */
export const CacheSetBatchEntrySchema = z.object({
  key: z.string(),
  value: z.string(),
  ttl: z.number().int().positive().optional(),
});

// Inferred types
export type CacheBackendType = z.infer<typeof CacheBackendTypeSchema>;
export type CacheSetBatchEntry = z.infer<typeof CacheSetBatchEntrySchema>;
