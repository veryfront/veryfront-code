/**
 * Data module types
 *
 * Re-exports schema types and defines interfaces with methods.
 */

// Re-export schema types
export type {
  CacheEntry,
  DataContext,
  DataResult,
  Redirect,
  StaticPathEntry,
  StaticPathsResult,
} from "./schemas/index.ts";

// Import for use in interfaces
import type { DataContext, DataResult, StaticPathsResult } from "./schemas/index.ts";

/**
 * Page or layout module with optional server and static data loaders.
 */
export interface PageWithData<T = unknown> {
  /** Default page or layout export. */
  default: unknown;
  /** Load request-scoped data. */
  getServerData?: (context: DataContext) => DataResult<T> | Promise<DataResult<T>>;
  /** Load cacheable data without request or query access. */
  getStaticData?: (
    context: Omit<DataContext, "request" | "query">,
  ) => DataResult<T> | Promise<DataResult<T>>;
  /** Declare dynamic routes to generate. */
  getStaticPaths?: () => StaticPathsResult | Promise<StaticPathsResult>;
}

/**
 * Infer the props type declared by a page data module.
 */
export type InferGetServerDataProps<T> = T extends PageWithData<infer P> ? P : never;
