import { defineSchema } from "#veryfront/schemas/index.ts";
import type { InferSchema } from "#veryfront/extensions/schema/index.ts";

/** Context used for generating cache keys in multi-project environments */
export const getCacheKeyContextSchema = defineSchema((v) =>
  v.object({
    projectId: v.string().min(1, "projectId cannot be empty"),
    mode: v.enum(["production", "preview"]),
    versionId: v.string().min(1, "versionId cannot be empty"),
  })
);

// Inferred type
export type CacheKeyContext = InferSchema<ReturnType<typeof getCacheKeyContextSchema>>;

// Backward compat alias
export const CacheKeyContextSchema = getCacheKeyContextSchema();
