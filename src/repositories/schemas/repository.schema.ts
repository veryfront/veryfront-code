import { z } from "zod";

export const RepositoryContextSchema = z.object({
  projectId: z.string(),
  environment: z.enum(["production", "preview"]),
  versionId: z.string(),
});

export const CacheStatsSchema = z.object({
  gets: z.number().int().nonnegative(),
  hits: z.number().int().nonnegative(),
  misses: z.number().int().nonnegative(),
  sets: z.number().int().nonnegative(),
  deletes: z.number().int().nonnegative(),
  hitRate: z.number().min(0).max(1),
});

export const CacheRepositoryOptionsSchema = z.object({
  name: z.string().optional(),
  defaultTtlSeconds: z.number().int().positive().optional(),
  maxEntries: z.number().int().positive().optional(),
});

export const FileSystemRepositoryOptionsSchema = z.object({
  baseDir: z.string(),
  securityContext: z
    .enum([
      "user-input",
      "static-serving",
      "build",
      "internal",
      "route-discovery",
      "module-loading",
    ])
    .optional(),
});

// Inferred types
export type RepositoryContext = z.infer<typeof RepositoryContextSchema>;
export type CacheStats = z.infer<typeof CacheStatsSchema>;
export type CacheRepositoryOptions = z.infer<typeof CacheRepositoryOptionsSchema>;
export type FileSystemRepositoryOptions = z.infer<typeof FileSystemRepositoryOptionsSchema>;
