/****
 * Resource Types
 *
 * Type definitions for MCP resources.
 *
 * @module veryfront/resource
 */

import type { z } from "zod";

export type CachePolicy = "no-cache" | "cache" | "cache-first";

export interface McpConfig {
  enabled?: boolean;
  cachePolicy?: CachePolicy;
}

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
