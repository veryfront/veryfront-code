import { defineSchema, lazySchema } from "#veryfront/schemas/index.ts";
import type { InferSchema } from "#veryfront/extensions/schema/index.ts";
import { containsUnsafeCacheStringCharacter } from "../validation.ts";

/** Context used for generating cache keys in multi-project environments */
export const getCacheKeyContextSchema = defineSchema((v) =>
  v.object({
    projectId: v.string().min(1, "projectId cannot be empty").max(4096).refine(
      (value: string) => !containsUnsafeCacheStringCharacter(value),
      "projectId must not contain control characters or unpaired UTF-16 surrogates",
    ),
    mode: v.enum(["production", "preview"]),
    versionId: v.string().min(1, "versionId cannot be empty").max(4096).refine(
      (value: string) => !containsUnsafeCacheStringCharacter(value),
      "versionId must not contain control characters or unpaired UTF-16 surrogates",
    ),
  })
);

// Inferred type
export type CacheKeyContext = InferSchema<ReturnType<typeof getCacheKeyContextSchema>>;

// Backward compat alias
export const CacheKeyContextSchema = lazySchema(getCacheKeyContextSchema);
