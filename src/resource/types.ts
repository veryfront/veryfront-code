/****
 * Resource Types
 *
 * Type definitions for MCP resources.
 *
 * @module veryfront/resource
 */

import type { Schema } from "#veryfront/extensions/schema/index.ts";

// Re-export schema-based types
export type { CachePolicy, McpConfig } from "./schemas/index.ts";

// Import for use in interface definitions
import type { McpConfig } from "./schemas/index.ts";

/** Configuration used by resource. */
export interface ResourceConfig<TParams = unknown, TData = unknown> {
  pattern?: string;
  description: string;
  title?: string;
  paramsSchema: Schema<TParams>;
  load: (params: TParams) => Promise<TData> | TData;
  subscribe?: (params: TParams) => AsyncIterable<TData>;
  mcp?: McpConfig;
}

/** Public API contract for resource. */
export interface Resource<TParams = unknown, TData = unknown> {
  id: string;
  pattern: string;
  description: string;
  title?: string;
  paramsSchema: Schema<TParams>;
  load: (params: TParams) => Promise<TData>;
  subscribe?: (params: TParams) => AsyncIterable<TData>;
  mcp?: McpConfig;
}
