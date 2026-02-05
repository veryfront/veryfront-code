import { z } from "zod";

/** Context used for generating cache keys in multi-project environments */
export const CacheKeyContextSchema = z.object({
  projectId: z.string().min(1, "projectId cannot be empty"),
  mode: z.enum(["production", "preview"]),
  versionId: z.string().min(1, "versionId cannot be empty"),
});

// Inferred type
export type CacheKeyContext = z.infer<typeof CacheKeyContextSchema>;
