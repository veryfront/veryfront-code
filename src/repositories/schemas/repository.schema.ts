import { defineSchema, lazySchema } from "#veryfront/schemas/index.ts";
import type { InferSchema } from "#veryfront/extensions/schema/index.ts";
import { MAX_CACHE_TTL_SECONDS } from "#veryfront/cache/backends/ttl.ts";
import {
  isRepositoryCacheName,
  isRepositoryIdentityComponent,
  MAX_REPOSITORY_CACHE_NAME_CODE_UNITS,
  MAX_REPOSITORY_IDENTITY_CODE_UNITS,
} from "../constraints.ts";

export const getRepositoryContextSchema = defineSchema((v) =>
  v.object({
    projectId: v.string()
      .min(1)
      .max(MAX_REPOSITORY_IDENTITY_CODE_UNITS)
      .refine(
        isRepositoryIdentityComponent,
        "projectId must be trimmed, well-formed, and contain no control characters",
      ),
    environment: v.enum(["production", "preview"]),
    versionId: v.string()
      .min(1)
      .max(MAX_REPOSITORY_IDENTITY_CODE_UNITS)
      .refine(
        isRepositoryIdentityComponent,
        "versionId must be trimmed, well-formed, and contain no control characters",
      ),
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
    name: v.string()
      .min(1)
      .max(MAX_REPOSITORY_CACHE_NAME_CODE_UNITS)
      .refine(
        isRepositoryCacheName,
        "name must be trimmed, well-formed, and contain no control characters",
      )
      .optional(),
    defaultTtlSeconds: v.number().int().positive().max(MAX_CACHE_TTL_SECONDS).optional(),
    maxEntries: v.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
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
