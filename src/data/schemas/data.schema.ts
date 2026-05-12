import { defineSchema } from "#veryfront/schemas/index.ts";
import type { InferSchema } from "#veryfront/extensions/schema/index.ts";

/** Context passed to data fetching functions */
export const getDataContextSchema = defineSchema((v) =>
  v.object({
    params: v.record(v.string(), v.union([v.string(), v.array(v.string())])),
    query: v.instanceof(URLSearchParams),
    request: v.instanceof(Request),
    url: v.instanceof(URL),
  })
);

export const getRedirectSchema = defineSchema((v) =>
  v.object({
    destination: v.string(),
    permanent: v.boolean().optional(),
  })
);

/** Result returned from data fetching functions */
export const getDataResultSchema = defineSchema((v) =>
  v.object({
    props: v.unknown().optional(),
    redirect: getRedirectSchema().optional(),
    notFound: v.boolean().optional(),
    revalidate: v.union([v.number(), v.literal(false)]).optional(),
  })
);

export const getStaticPathEntrySchema = defineSchema((v) =>
  v.object({
    params: v.record(v.string(), v.union([v.string(), v.array(v.string())])),
  })
);

export const getStaticPathsResultSchema = defineSchema((v) =>
  v.object({
    paths: v.array(getStaticPathEntrySchema()),
    fallback: v.union([v.boolean(), v.literal("blocking")]),
  })
);

export const getCacheEntrySchema = defineSchema((v) =>
  v.object({
    data: getDataResultSchema(),
    timestamp: v.number(),
    revalidate: v.union([v.number(), v.literal(false)]).optional(),
  })
);

// Inferred types
export type DataContext = InferSchema<ReturnType<typeof getDataContextSchema>>;
export type Redirect = InferSchema<ReturnType<typeof getRedirectSchema>>;
export type DataResult<T = unknown> = InferSchema<ReturnType<typeof getDataResultSchema>> & {
  props?: T;
};
export type StaticPathEntry = InferSchema<ReturnType<typeof getStaticPathEntrySchema>>;
export type StaticPathsResult = InferSchema<ReturnType<typeof getStaticPathsResultSchema>>;
export type CacheEntry<T = unknown> = InferSchema<ReturnType<typeof getCacheEntrySchema>> & {
  data: DataResult<T>;
};

// Backward compat aliases
export const DataContextSchema = getDataContextSchema();
export const RedirectSchema = getRedirectSchema();
export const DataResultSchema = getDataResultSchema();
export const StaticPathEntrySchema = getStaticPathEntrySchema();
export const StaticPathsResultSchema = getStaticPathsResultSchema();
export const CacheEntrySchema = getCacheEntrySchema();
