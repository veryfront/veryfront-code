import { defineSchema, lazySchema } from "#veryfront/schemas/index.ts";
import type { Schema, SchemaValidator } from "#veryfront/extensions/schema/index.ts";

const MAX_DATA_PARAMS = 256;
const MAX_PARAM_NAME_LENGTH = 256;
const MAX_PARAM_VALUE_LENGTH = 4_096;
const MAX_CATCH_ALL_SEGMENTS = 256;
const MAX_PARAM_TOTAL_LENGTH = 16_384;
const MAX_PARAM_TOTAL_SEGMENTS = 512;
const MAX_CONTEXT_URL_BYTES = 16_384;
const MAX_CONTEXT_QUERY_BYTES = 32_768;
const MAX_REDIRECT_DESTINATION_LENGTH = 8_192;
const MAX_STATIC_PATHS = 100_000;
const REDIRECT_VALIDATION_BASE_URL = "https://veryfront.invalid/";
const textEncoder = new TextEncoder();

function boundedUtf8ByteLength(value: string, maxBytes: number): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 0x7f) {
      bytes++;
    } else if (code <= 0x7ff) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index++;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
    if (bytes > maxBytes) return maxBytes + 1;
  }
  return bytes;
}

function queryWithinLimit(query: URLSearchParams): boolean {
  let bytes = 0;
  for (const [key, value] of query) {
    const remaining = MAX_CONTEXT_QUERY_BYTES - bytes;
    bytes += boundedUtf8ByteLength(key, remaining);
    if (bytes > MAX_CONTEXT_QUERY_BYTES) return false;
    bytes += boundedUtf8ByteLength(value, MAX_CONTEXT_QUERY_BYTES - bytes);
    if (bytes > MAX_CONTEXT_QUERY_BYTES) return false;
    bytes += 2;
    if (bytes > MAX_CONTEXT_QUERY_BYTES) return false;
  }
  return true;
}

function containsRedirectControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

/** Check a redirect destination without exposing it in an error. @internal */
export function isValidRedirectDestination(value: unknown): value is string {
  if (
    !(
      typeof value === "string" &&
      value.length > 0 &&
      value.length <= MAX_REDIRECT_DESTINATION_LENGTH &&
      value === value.trim() &&
      !containsRedirectControlCharacter(value) &&
      textEncoder.encode(value).byteLength <= MAX_REDIRECT_DESTINATION_LENGTH
    )
  ) {
    return false;
  }

  try {
    const parsed = new URL(value, REDIRECT_VALIDATION_BASE_URL);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/** Context passed to page data loaders. */
export interface DataContext {
  /** Dynamic route parameters. */
  params: Record<string, string | string[]>;
  /** Parsed request query parameters. */
  query: URLSearchParams;
  /** Incoming request for server data loaders. */
  request: Request;
  /** Parsed request URL. */
  url: URL;
}

/** Redirect returned by a page data loader. */
export interface Redirect {
  /** Absolute URL or application-relative destination. */
  destination: string;
  /** Whether the redirect is permanent. */
  permanent?: boolean;
}

/** Result returned by a server or static page data loader. */
export interface DataResult<T = unknown> {
  /** Props supplied to the page or layout. */
  props?: T;
  /** Redirect response, which takes precedence over `notFound`. */
  redirect?: Redirect;
  /** Whether the route resolves as not found. */
  notFound?: boolean;
  /** Revalidation interval in seconds, or `false` to disable revalidation. */
  revalidate?: number | false;
}

/** One route produced by `getStaticPaths()`. */
export interface StaticPathEntry {
  /** Dynamic route parameters for the generated path. */
  params: Record<string, string | string[]>;
}

/** Return value from `getStaticPaths()`. */
export interface StaticPathsResult {
  /** Routes to pre-render. */
  paths: StaticPathEntry[];
  /** Behavior for paths not returned in `paths`. */
  fallback: boolean | "blocking";
}

/** Cached page data and its revalidation metadata. */
export interface CacheEntry<T = unknown> {
  /** Cached loader result. */
  data: DataResult<T>;
  /** Unix timestamp in milliseconds when the entry was written. */
  timestamp: number;
  /** Revalidation interval copied from the loader result. */
  revalidate?: number | false;
}

function getParamsSchema(v: SchemaValidator): Schema<Record<string, string | string[]>> {
  return v.record(
    v.string().min(1).max(MAX_PARAM_NAME_LENGTH),
    v.union([
      v.string().max(MAX_PARAM_VALUE_LENGTH),
      v.array(v.string().max(MAX_PARAM_VALUE_LENGTH)).max(MAX_CATCH_ALL_SEGMENTS),
    ]),
  ).superRefine((params, ctx) => {
    const entries = Object.entries(params);
    if (entries.length > MAX_DATA_PARAMS) {
      ctx.addIssue({
        message: `Route params cannot contain more than ${MAX_DATA_PARAMS} entries`,
      });
      return;
    }

    let totalLength = 0;
    let totalSegments = 0;
    for (const [key, value] of entries) {
      totalLength += key.length;
      if (Array.isArray(value)) {
        totalSegments += value.length;
        for (const segment of value) totalLength += segment.length;
      } else {
        totalSegments++;
        totalLength += value.length;
      }
      if (
        totalLength > MAX_PARAM_TOTAL_LENGTH ||
        totalSegments > MAX_PARAM_TOTAL_SEGMENTS
      ) {
        ctx.addIssue({ message: "Route params exceed the aggregate size limit" });
        return;
      }
    }
  });
}

/** Context passed to data fetching functions */
export const getDataContextSchema: () => Schema<DataContext> = defineSchema((v) =>
  v.object({
    params: getParamsSchema(v),
    query: v.instanceof(URLSearchParams),
    request: v.instanceof(Request),
    url: v.instanceof(URL),
  }).strip().superRefine((context, ctx) => {
    try {
      if (
        boundedUtf8ByteLength(context.url.href, MAX_CONTEXT_URL_BYTES) >
          MAX_CONTEXT_URL_BYTES ||
        boundedUtf8ByteLength(context.request.url, MAX_CONTEXT_URL_BYTES) >
          MAX_CONTEXT_URL_BYTES
      ) {
        ctx.addIssue({ message: "Data context URL exceeds the size limit" });
      }
      if (!queryWithinLimit(context.query)) {
        ctx.addIssue({ message: "Data context query exceeds the size limit" });
      }
    } catch {
      ctx.addIssue({ message: "Data context URL state is unreadable" });
    }
  })
);

/** Schema for a loader redirect. */
export const getRedirectSchema: () => Schema<Redirect> = defineSchema((v) =>
  v.object({
    destination: v.string().min(1).max(MAX_REDIRECT_DESTINATION_LENGTH),
    permanent: v.boolean().optional(),
  }).strip().superRefine((redirect, ctx) => {
    if (isValidRedirectDestination(redirect.destination)) return;
    ctx.addIssue({ message: "Redirect destination is invalid" });
  })
);

/** Result returned from data fetching functions */
export const getDataResultSchema: () => Schema<DataResult> = defineSchema((v) =>
  v.object({
    props: v.unknown().optional(),
    redirect: getRedirectSchema().optional(),
    notFound: v.boolean().optional(),
    revalidate: v.union([v.number(), v.literal(false)]).optional(),
  }).strip()
);

/** Schema for one route returned by `getStaticPaths()`. */
export const getStaticPathEntrySchema: () => Schema<StaticPathEntry> = defineSchema((v) =>
  v.object({
    params: getParamsSchema(v),
  }).strip()
);

/** Schema for the result returned by `getStaticPaths()`. */
export const getStaticPathsResultSchema: () => Schema<StaticPathsResult> = defineSchema((v) =>
  v.object({
    paths: v.array(getStaticPathEntrySchema()).max(MAX_STATIC_PATHS),
    fallback: v.union([v.boolean(), v.literal("blocking")]),
  }).strip()
);

/** Schema for an in-memory page data cache entry. */
export const getCacheEntrySchema: () => Schema<CacheEntry> = defineSchema((v) =>
  v.object({
    data: getDataResultSchema(),
    timestamp: v.number().nonnegative(),
    revalidate: v.union([v.number(), v.literal(false)]).optional(),
  }).strip()
);

// Backward compat aliases
export const DataContextSchema = lazySchema(getDataContextSchema);
export const RedirectSchema = lazySchema(getRedirectSchema);
export const DataResultSchema = lazySchema(getDataResultSchema);
export const StaticPathEntrySchema = lazySchema(getStaticPathEntrySchema);
export const StaticPathsResultSchema = lazySchema(getStaticPathsResultSchema);
export const CacheEntrySchema = lazySchema(getCacheEntrySchema);
