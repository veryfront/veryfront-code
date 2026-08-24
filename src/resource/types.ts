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

/**
 * Configuration used by resource. URI captures are decoded exactly once before
 * schema validation; malformed percent escapes do not match a resource.
 */
export interface ResourceConfig<TParams = unknown, TData = unknown> {
  /**
   * URI template using `:name` parameters. Hierarchical (`/users/:id`) and
   * rootless (`docs:collection/:id`) paths are supported, as are embedded and
   * query parameters (`/file-:base.:ext?lang=:lang`). Opaque identifiers such
   * as `urn:isbn` remain literal. Parameter names must be unique and separated
   * by literal text; the first following literal delimits an embedded value.
   * A `:` directly following an alphanumeric character is always data, never a
   * parameter: write `/files/file-:id`, not `/files/file:id`. This keeps
   * opaque colon identifiers literal under one uniform rule.
   */
  pattern?: string;
  description: string;
  title?: string;
  paramsSchema: Schema<TParams>;
  load: (params: TParams) => Promise<TData> | TData;
  subscribe?: (params: TParams) => AsyncIterable<TData>;
  /** MCP configuration. `enabled: false` hides the resource from lists and reads. */
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
