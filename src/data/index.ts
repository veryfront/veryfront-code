/**
 * Server-side data fetching for pages. Provides the DataFetcher class and
 * helper functions like `notFound` and `redirect` for route-level data loading.
 *
 * @module data
 */

export type {
  CacheEntry,
  DataContext,
  DataResult,
  InferGetServerDataProps,
  PageWithData,
  StaticDataPrimitive,
  StaticDataResult,
  StaticDataValue,
  StaticPathsResult,
} from "./types.ts";
export { type DataCacheScope, snapshotDataCacheScope } from "./data-fetching-cache.ts";
export { DataFetcher, type DataFetcherOptions, type FetchDataOptions } from "./data-fetcher.ts";
export { notFound, redirect } from "./helpers.ts";
export type { StaticPathsFetchOptions } from "./static-paths-fetcher.ts";
