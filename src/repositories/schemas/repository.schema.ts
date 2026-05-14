import { defineSchema, lazySchema } from "#veryfront/schemas/index.ts";
import type { InferSchema } from "#veryfront/extensions/schema/index.ts";

export const getRepositoryContextSchema = defineSchema((v) =>
  v.object({
    projectId: v.string(),
    environment: v.enum(["production", "preview"]),
    versionId: v.string(),
  })
);

export const getCacheStatsSchema = defineSchema((v) =>
  v.object({
    gets: v.number().int().nonnegative(),
    hits: v.number().int().nonnegative(),
    misses: v.number().int().nonnegative(),
    sets: v.number().int().nonnegative(),
    deletes: v.number().int().nonnegative(),
    hitRate: v.number().min(0).max(1),
  })
);

export const getCacheRepositoryOptionsSchema = defineSchema((v) =>
  v.object({
    name: v.string().optional(),
    defaultTtlSeconds: v.number().int().positive().optional(),
    maxEntries: v.number().int().positive().optional(),
  })
);

// Inferred types
export type RepositoryContext = InferSchema<ReturnType<typeof getRepositoryContextSchema>>;
export type CacheStats = InferSchema<ReturnType<typeof getCacheStatsSchema>>;
export type CacheRepositoryOptions = InferSchema<
  ReturnType<typeof getCacheRepositoryOptionsSchema>
>;

// Backward compat aliases
export const RepositoryContextSchema = lazySchema(getRepositoryContextSchema);
export const CacheStatsSchema = lazySchema(getCacheStatsSchema);
export const CacheRepositoryOptionsSchema = lazySchema(getCacheRepositoryOptionsSchema);
