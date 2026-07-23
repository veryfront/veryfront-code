import { defineSchema, lazySchema } from "#veryfront/schemas/index.ts";
import type { InferSchema } from "#veryfront/extensions/schema/index.ts";
import { containsUnsafeCacheStringCharacter } from "../validation.ts";

const MAX_CACHE_KEY_LENGTH = 4096;
const MAX_CACHE_VALUE_LENGTH = 64 * 1024 * 1024;
const MAX_CACHE_TTL_SECONDS = 365 * 24 * 60 * 60;

export const getCacheBackendTypeSchema = defineSchema((v) =>
  v.enum(["memory", "redis", "api", "disk"])
);

export const getCacheSetBatchEntrySchema = defineSchema((v) =>
  v.object({
    key: v.string().min(1).max(MAX_CACHE_KEY_LENGTH).refine(
      (value: string) => !containsUnsafeCacheStringCharacter(value),
      "Cache keys must not contain control characters or unpaired UTF-16 surrogates",
    ),
    value: v.string().max(MAX_CACHE_VALUE_LENGTH),
    ttl: v.number().int().positive().max(MAX_CACHE_TTL_SECONDS).optional(),
  })
);

// Inferred types
export type CacheBackendType = InferSchema<ReturnType<typeof getCacheBackendTypeSchema>>;
export type CacheSetBatchEntry = InferSchema<ReturnType<typeof getCacheSetBatchEntrySchema>>;

// Backward compat aliases
export const CacheBackendTypeSchema = lazySchema(getCacheBackendTypeSchema);
export const CacheSetBatchEntrySchema = lazySchema(getCacheSetBatchEntrySchema);
