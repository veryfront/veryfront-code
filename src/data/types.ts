/**
 * Data module types
 *
 * Re-exports schema types and defines interfaces with methods.
 */

// Re-export schema types
export type { CacheEntry, DataContext, DataResult, StaticPathsResult } from "./schemas/index.ts";

// Import for use in interfaces
import type { DataContext, DataResult, StaticPathsResult } from "./schemas/index.ts";

/**
 * Page with data fetching capabilities
 */
export interface PageWithData<T = unknown> {
  default: unknown;
  getServerData?: (context: DataContext) => DataResult<T> | Promise<DataResult<T>>;
  getStaticData?: (
    context: Omit<DataContext, "request" | "query">,
  ) => DataResult<T> | Promise<DataResult<T>>;
  getStaticPaths?: () => StaticPathsResult | Promise<StaticPathsResult>;
}

/**
 * Utility type to infer props from a page with data
 */
export type InferGetServerDataProps<T> = T extends PageWithData<infer P> ? P : never;
