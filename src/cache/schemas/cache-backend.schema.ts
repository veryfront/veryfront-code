import { defineSchema, lazySchema } from "#veryfront/schemas/index.ts";
import type { InferSchema } from "#veryfront/extensions/schema/index.ts";
import { MAX_CACHE_TTL_SECONDS } from "../backends/ttl.ts";

export const getCacheBackendTypeSchema = defineSchema((v) =>
  v.enum(["memory", "distributed", "api", "disk"])
);

export const getCacheSetBatchEntrySchema = defineSchema((v) =>
  v.object({
    key: v.string(),
    value: v.string(),
    ttl: v.number().max(MAX_CACHE_TTL_SECONDS).optional(),
  })
);

// Inferred types
export type CacheBackendType = InferSchema<ReturnType<typeof getCacheBackendTypeSchema>>;
export type CacheSetBatchEntry = InferSchema<ReturnType<typeof getCacheSetBatchEntrySchema>>;

export const CacheBackendTypeSchema = lazySchema(getCacheBackendTypeSchema);
export const CacheSetBatchEntrySchema = lazySchema(getCacheSetBatchEntrySchema);
