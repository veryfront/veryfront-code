/**
 * Resource Types
 *
 * Type definitions for MCP resources.
 *
 * @module veryfront/resource
 */

import type { z } from "zod";

/**
 * Resource configuration
 */
export interface ResourceConfig<TParams = unknown, TData = unknown> {
  /** Resource path pattern (e.g., "/users/:userId/profile") */
  pattern?: string;

  /** Resource description */
  description: string;

  /** Parameters schema */
  paramsSchema: z.ZodSchema<TParams>;

  /**
   * Load resource data
   */
  load: (params: TParams) => Promise<TData> | TData;

  /**
   * Subscribe to resource updates (optional)
   */
  subscribe?: (params: TParams) => AsyncIterable<TData>;

  /** MCP configuration */
  mcp?: {
    /** Expose via MCP */
    enabled?: boolean;

    /** Cache policy */
    cachePolicy?: "no-cache" | "cache" | "cache-first";
  };
}

/**
 * Resource instance
 */
export interface Resource<TParams = unknown, TData = unknown> {
  /** Resource ID */
  id: string;

  /** Resource path pattern */
  pattern: string;

  /** Resource description */
  description: string;

  /** Parameters schema */
  paramsSchema: z.ZodSchema<TParams>;

  /**
   * Load resource data
   */
  load: (params: TParams) => Promise<TData>;

  /**
   * Subscribe to updates
   */
  subscribe?: (params: TParams) => AsyncIterable<TData>;

  /** MCP configuration */
  mcp?: ResourceConfig["mcp"];
}
