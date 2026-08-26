import { defineSchema, lazySchema } from "#veryfront/schemas/index.ts";
import type { InferSchema } from "#veryfront/extensions/schema/index.ts";
import { normalizeDataResponseMetadata } from "../response-metadata.ts";
import type { ApplicationIdentity } from "#veryfront/security/application-auth/types.ts";

function hasValidResponseMetadata(value: { headers?: unknown; cookies?: unknown }): boolean {
  try {
    normalizeDataResponseMetadata(value);
    return true;
  } catch {
    return false;
  }
}

function hasValidResponseCookie(value: unknown): boolean {
  try {
    normalizeDataResponseMetadata({ cookies: [value] });
    return true;
  } catch {
    return false;
  }
}

function hasValidActiveRevalidate(value: {
  redirect?: unknown;
  notFound?: unknown;
  revalidate?: unknown;
}): boolean {
  if (value.redirect !== undefined || value.notFound === true) return true;
  return value.revalidate === undefined || value.revalidate === false ||
    (typeof value.revalidate === "number" &&
      Number.isFinite(value.revalidate) && value.revalidate >= 0);
}

/** Context passed to data fetching functions */
export const getDataContextSchema = defineSchema((v) =>
  v.object({
    params: v.record(v.string(), v.union([v.string(), v.array(v.string())])),
    query: v.instanceof(URLSearchParams),
    request: v.instanceof(Request),
    url: v.instanceof(URL),
    identity: v.custom<ApplicationIdentity | null>(() => true).optional(),
    applicationIdentity: v.custom<ApplicationIdentity | null>(() => true).optional(),
  })
);

export const getRedirectSchema = defineSchema((v) =>
  v.object({
    destination: v.string(),
    permanent: v.boolean().optional(),
  })
);

export const getResponseCookieSchema = defineSchema((v) =>
  v.object({
    name: v.string(),
    value: v.string(),
    domain: v.string().optional(),
    path: v.string().optional(),
    expires: v.string().optional(),
    maxAge: v.number().optional(),
    httpOnly: v.boolean().optional(),
    secure: v.boolean().optional(),
    sameSite: v.union([v.literal("lax"), v.literal("strict"), v.literal("none")]).optional(),
  }).strict().refine(hasValidResponseCookie, "Response cookie is invalid")
);

/** Result returned from data fetching functions */
export const getDataResultSchema = defineSchema((v) =>
  v.object({
    props: v.unknown().optional(),
    redirect: getRedirectSchema().optional(),
    notFound: v.boolean().optional(),
    revalidate: v.unknown().optional(),
    headers: v.record(v.string(), v.string()).optional(),
    cookies: v.array(getResponseCookieSchema()).optional(),
  })
    .refine(hasValidActiveRevalidate, "Data result revalidate value is invalid")
    .refine(hasValidResponseMetadata, "Data result response metadata is invalid")
);

/** Cache-safe result returned from getStaticData. */
export const getStaticDataResultSchema = defineSchema((v) =>
  v.object({
    props: v.unknown().optional(),
    redirect: getRedirectSchema().optional(),
    notFound: v.boolean().optional(),
    revalidate: v.unknown().optional(),
    headers: v.custom<never>(() => false, "getStaticData cannot return response headers")
      .optional(),
    cookies: v.custom<never>(() => false, "getStaticData cannot return response cookies")
      .optional(),
  }).refine(hasValidActiveRevalidate, "Static data result revalidate value is invalid")
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
    data: getStaticDataResultSchema(),
    timestamp: v.number(),
    revalidate: v.union([v.number(), v.literal(false)]).optional(),
  })
);

// Inferred types
/** Context passed to `getServerData()`. */
export type DataContext = InferSchema<ReturnType<typeof getDataContextSchema>>;
export type Redirect = InferSchema<ReturnType<typeof getRedirectSchema>>;
/** One cookie emitted as a distinct Set-Cookie response field. */
export type ResponseCookie = InferSchema<ReturnType<typeof getResponseCookieSchema>>;
/** Custom document response metadata returned from `getServerData()`. */
export interface DataResponseMetadata {
  headers?: Record<string, string>;
  cookies?: ResponseCookie[];
}
/** Props, routing control, caching, and response metadata returned from `getServerData()`. */
export type DataResult<T = unknown> =
  & Omit<InferSchema<ReturnType<typeof getDataResultSchema>>, "props" | "revalidate">
  & {
    props?: T;
    revalidate?: number | false;
  };
/** Cache-safe result returned from `getStaticData()`. */
export type StaticDataResult<T = unknown> =
  & Omit<
    InferSchema<ReturnType<typeof getStaticDataResultSchema>>,
    "props" | "revalidate" | "headers" | "cookies"
  >
  & {
    props?: T;
    revalidate?: number | false;
    headers?: never;
    cookies?: never;
  };
export type StaticPathEntry = InferSchema<ReturnType<typeof getStaticPathEntrySchema>>;
/** Return type for `getStaticPaths()`. */
export type StaticPathsResult = InferSchema<ReturnType<typeof getStaticPathsResultSchema>>;
export type CacheEntry<T = unknown> = InferSchema<ReturnType<typeof getCacheEntrySchema>> & {
  data: StaticDataResult<T>;
};

// Backward compat aliases
export const DataContextSchema = lazySchema(getDataContextSchema);
export const RedirectSchema = lazySchema(getRedirectSchema);
export const ResponseCookieSchema = lazySchema(getResponseCookieSchema);
export const DataResultSchema = lazySchema(getDataResultSchema);
export const StaticDataResultSchema = lazySchema(getStaticDataResultSchema);
export const StaticPathEntrySchema = lazySchema(getStaticPathEntrySchema);
export const StaticPathsResultSchema = lazySchema(getStaticPathsResultSchema);
export const CacheEntrySchema = lazySchema(getCacheEntrySchema);
