/**
 * Redis Backend Types
 *
 * Type definitions for Redis backend configuration.
 *
 * @module ai/workflow/backends/redis/types
 */

import type { BackendConfig } from "../types.ts";
import type { RedisAdapter } from "#veryfront/platform/adapters/redis/index.ts";

// Re-export platform types for convenience
export type {
  DenoRedisClient,
  DenoRedisModule,
  NodeRedisClient,
  NodeRedisModule,
  RedisAdapter,
} from "#veryfront/platform/adapters/redis/index.ts";

/**
 * Redis backend configuration
 */
export interface RedisBackendConfig extends BackendConfig {
  /** Redis connection URL or config */
  url?: string;
  /** Redis hostname */
  hostname?: string;
  /** Redis port */
  port?: number;
  /** Key prefix for namespacing */
  prefix?: string;
  /** Stream name for job queue */
  streamKey?: string;
  /** Consumer group name */
  groupName?: string;
  /** Consumer name (unique per worker) */
  consumerName?: string;
  /** Default TTL for runs (in seconds) */
  runTtl?: number;
  /** Enable debug logging */
  debug?: boolean;
  /** Existing Redis client (optional) */
  client?: RedisAdapter;
}

/**
 * Internal config type with required defaults
 */
export type RedisBackendInternalConfig =
  & Required<
    Pick<RedisBackendConfig, "prefix" | "streamKey" | "groupName" | "consumerName" | "debug">
  >
  & RedisBackendConfig;
