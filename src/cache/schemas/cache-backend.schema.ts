import { defineSchema, lazySchema } from "#veryfront/schemas/index.ts";
import type { InferSchema } from "#veryfront/extensions/schema/index.ts";

export const getCacheBackendTypeSchema = defineSchema((v) =>
  v.enum(["memory", "redis", "api", "disk"])
);

export const getCacheSetBatchEntrySchema = defineSchema((v) =>
  v.object({
    key: v.string(),
    value: v.string(),
    ttl: v.number().int().positive().optional(),
  })
);

// Inferred types
export type CacheBackendType = InferSchema<ReturnType<typeof getCacheBackendTypeSchema>>;
export type CacheSetBatchEntry = InferSchema<ReturnType<typeof getCacheSetBatchEntrySchema>>;

// Backward compat aliases
export const CacheBackendTypeSchema = lazySchema(getCacheBackendTypeSchema);
export const CacheSetBatchEntrySchema = lazySchema(getCacheSetBatchEntrySchema);
