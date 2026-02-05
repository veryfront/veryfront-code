/****
 * Resource Types
 *
 * Type definitions for MCP resources.
 *
 * @module veryfront/resource
 */

import type { z } from "zod";

// Re-export schema-based types
export type { CachePolicy, McpConfig } from "./schemas/index.ts";

// Import for use in interface definitions
import type { McpConfig } from "./schemas/index.ts";

export interface ResourceConfig<TParams = unknown, TData = unknown> {
  pattern?: string;
  description: string;
  paramsSchema: z.ZodSchema<TParams>;
  load: (params: TParams) => Promise<TData> | TData;
  subscribe?: (params: TParams) => AsyncIterable<TData>;
  mcp?: McpConfig;
}

export interface Resource<TParams = unknown, TData = unknown> {
  id: string;
  pattern: string;
  description: string;
  paramsSchema: z.ZodSchema<TParams>;
  load: (params: TParams) => Promise<TData>;
  subscribe?: (params: TParams) => AsyncIterable<TData>;
  mcp?: McpConfig;
}
