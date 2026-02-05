/**
 * Data module schemas
 *
 * Schemas for data fetching context and results.
 */

import { z } from "zod";

/**
 * Data context schema - context passed to data fetching functions
 */
export const DataContextSchema = z.object({
  params: z.record(z.union([z.string(), z.array(z.string())])),
  query: z.instanceof(URLSearchParams),
  request: z.instanceof(Request),
  url: z.instanceof(URL),
});

/**
 * Redirect schema
 */
export const RedirectSchema = z.object({
  destination: z.string(),
  permanent: z.boolean().optional(),
});

/**
 * Data result schema - result returned from data fetching functions
 */
export const DataResultSchema = z.object({
  props: z.unknown().optional(),
  redirect: RedirectSchema.optional(),
  notFound: z.boolean().optional(),
  revalidate: z.union([z.number(), z.literal(false)]).optional(),
});

/**
 * Static path entry schema
 */
export const StaticPathEntrySchema = z.object({
  params: z.record(z.union([z.string(), z.array(z.string())])),
});

/**
 * Static paths result schema
 */
export const StaticPathsResultSchema = z.object({
  paths: z.array(StaticPathEntrySchema),
  fallback: z.union([z.boolean(), z.literal("blocking")]),
});

/**
 * Cache entry schema
 */
export const CacheEntrySchema = z.object({
  data: DataResultSchema,
  timestamp: z.number(),
  revalidate: z.union([z.number(), z.literal(false)]).optional(),
});

// Inferred types
export type DataContext = z.infer<typeof DataContextSchema>;
export type Redirect = z.infer<typeof RedirectSchema>;
export type DataResult<T = unknown> = z.infer<typeof DataResultSchema> & { props?: T };
export type StaticPathEntry = z.infer<typeof StaticPathEntrySchema>;
export type StaticPathsResult = z.infer<typeof StaticPathsResultSchema>;
export type CacheEntry<T = unknown> = z.infer<typeof CacheEntrySchema> & {
  data: DataResult<T>;
};
