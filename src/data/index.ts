/**
 * Server-side data fetching for pages. Provides the DataFetcher class and
 * helper functions like `notFound` and `redirect` for route-level data loading.
 *
 * @module data
 */

export type {
  CacheEntry,
  DataContext,
  DataResponseMetadata,
  DataResult,
  InferGetServerDataProps,
  PageWithData,
  ResponseCookie,
  StaticDataResult,
  StaticPathsResult,
} from "./types.ts";
export { DataFetcher, type FetchDataOptions } from "./data-fetcher.ts";
export { notFound, redirect } from "./helpers.ts";
