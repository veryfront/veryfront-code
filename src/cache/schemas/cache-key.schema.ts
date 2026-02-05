/**
 * Cache key context schemas
 *
 * Schemas for cache key generation and context management.
 */

import { z } from "zod";

/**
 * Schema for cache key context.
 * Defines the context used for generating cache keys in multi-project environments.
 */
export const CacheKeyContextSchema = z.object({
  projectId: z.string().min(1, "projectId cannot be empty"),
  mode: z.enum(["production", "preview"]),
  versionId: z.string().min(1, "versionId cannot be empty"),
});

// Inferred type
export type CacheKeyContext = z.infer<typeof CacheKeyContextSchema>;
