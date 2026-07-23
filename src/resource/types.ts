/**
 * Resource Types
 *
 * Type definitions for MCP resources.
 *
 * @module veryfront/resource
 */

// Re-export schema-based types
export type { CachePolicy, McpConfig } from "./schemas/index.ts";

// Import for use in interface definitions
import type { McpConfig } from "./schemas/index.ts";

/** Cancellation and lifecycle values available while reading a resource. */
export interface ResourceLoadContext {
  /** Signal that aborts loading or subscription work when the caller no longer needs it. */
  readonly signal?: AbortSignal;
}

/** Minimal validation contract required by resource definitions. */
export interface ResourceParamsSchema<T = unknown> {
  /** Parse unknown input or throw a validation error. */
  parse(data: unknown): T;
}

/** Configuration used to create a resource. */
export interface ResourceConfig<TParams = unknown, TData = unknown> {
  /** Explicit registry identity. Defaults to an identity derived from pattern. */
  readonly id?: string;
  /** Resource URI pattern. Discovery may supply this from the source path. */
  readonly pattern?: string;
  /** Human-readable description exposed to resource clients. */
  readonly description: string;
  /** Optional human-readable display title. */
  readonly title?: string;
  /** Schema that validates and may transform resource parameters. */
  readonly paramsSchema: ResourceParamsSchema<TParams>;
  /** Load the current resource value with an immutable lifecycle context. */
  readonly load: (
    params: TParams,
    context: ResourceLoadContext,
  ) => Promise<TData> | TData;
  /** Optionally stream resource updates with an immutable lifecycle context. */
  readonly subscribe?: (
    params: TParams,
    context: ResourceLoadContext,
  ) => AsyncIterable<TData>;
  /** MCP exposure and cache configuration. */
  readonly mcp?: McpConfig;
}

/** Public API contract for a validated resource definition. */
export interface Resource<TParams = unknown, TData = unknown> {
  /** Stable registry identifier. */
  readonly id: string;
  /** URI pattern used to find this resource. */
  readonly pattern: string;
  /** Human-readable description exposed to resource clients. */
  readonly description: string;
  /** Optional human-readable display title. */
  readonly title?: string;
  /** Schema used to validate resource parameters. */
  readonly paramsSchema: ResourceParamsSchema<TParams>;
  /** Validate parameters and load the current value. */
  load(
    params: TParams,
    context?: ResourceLoadContext,
  ): Promise<TData>;
  /** Validate parameters and stream updates when supported. */
  subscribe?(
    params: TParams,
    context?: ResourceLoadContext,
  ): AsyncIterable<TData>;
  /** MCP exposure and cache configuration. */
  readonly mcp?: Readonly<McpConfig>;
}
