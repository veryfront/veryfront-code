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
  StaticPathsResult,
} from "./types.ts";
export { DataFetcher } from "./data-fetcher.ts";
export { notFound, redirect } from "./helpers.ts";
