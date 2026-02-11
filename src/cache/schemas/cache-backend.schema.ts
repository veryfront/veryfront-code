import { z } from "zod";

export const CacheBackendTypeSchema = z.enum(["memory", "redis", "api", "disk"]);

export const CacheSetBatchEntrySchema = z.object({
  key: z.string(),
  value: z.string(),
  ttl: z.number().int().positive().optional(),
});

// Inferred types
export type CacheBackendType = z.infer<typeof CacheBackendTypeSchema>;
export type CacheSetBatchEntry = z.infer<typeof CacheSetBatchEntrySchema>;
