import { defineSchema, lazySchema } from "#veryfront/schemas/index.ts";
import type { InferSchema } from "#veryfront/extensions/schema/index.ts";
import { containsUnsafeCacheStringCharacter } from "#veryfront/cache/validation.ts";
import {
  MAX_REPOSITORY_CACHE_ENTRIES,
  MAX_REPOSITORY_CACHE_NAME_LENGTH,
  MAX_REPOSITORY_CACHE_TTL_SECONDS,
  MAX_REPOSITORY_IDENTITY_LENGTH,
} from "../limits.ts";
import { snapshotRepositoryContext } from "../context.ts";

function isSafeIdentity(value: string): boolean {
  return !containsUnsafeCacheStringCharacter(value);
}

function isUsableRepositoryContext(value: unknown): boolean {
  try {
    snapshotRepositoryContext(value);
    return true;
  } catch {
    return false;
  }
}

export const getRepositoryContextSchema = defineSchema((v) =>
  v.object({
    projectId: v.string().min(1).max(MAX_REPOSITORY_IDENTITY_LENGTH).refine(
      isSafeIdentity,
      "projectId must not contain control characters or unpaired UTF-16 surrogates",
    ),
    environment: v.enum(["production", "preview"]),
    versionId: v.string().min(1).max(MAX_REPOSITORY_IDENTITY_LENGTH).refine(
      isSafeIdentity,
      "versionId must not contain control characters or unpaired UTF-16 surrogates",
    ),
  }).refine(
    isUsableRepositoryContext,
    "Repository context must leave capacity for scoped cache keys",
  )
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
    name: v.string().min(1).max(MAX_REPOSITORY_CACHE_NAME_LENGTH).refine(
      isSafeIdentity,
      "Cache name must not contain control characters or unpaired UTF-16 surrogates",
    ).optional(),
    defaultTtlSeconds: v.number().positive().max(MAX_REPOSITORY_CACHE_TTL_SECONDS).optional(),
    maxEntries: v.number().int().positive().max(MAX_REPOSITORY_CACHE_ENTRIES).optional(),
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
