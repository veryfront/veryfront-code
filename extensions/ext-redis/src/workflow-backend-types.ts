/**
 * Redis Backend Types
 *
 * Type definitions for Redis backend configuration.
 *
 * @module ai/workflow/backends/redis/types
 */

import type { BackendConfig } from "veryfront/extensions/distributed/workflow-support";
import type { RedisAdapter } from "./redis-adapter.ts";

/** Result of one bounded Redis retention-maintenance pass. */
export interface RedisRetentionDrainResult {
  /** Retention ledger entries examined during this pass. */
  processed: number;
  /** Whether another already-due entry remains and another pass is required. */
  hasMoreDue: boolean;
}

// Re-export platform types for convenience
export type {
  NodeRedisClient,
  NodeRedisClientOptions,
  NodeRedisModule,
} from "./node-redis-types.ts";
export type { RedisAdapter } from "./redis-adapter.ts";

/**
 * Redis backend configuration
 */
export interface RedisBackendConfig extends BackendConfig {
  /**
   * Redis connection URL or config for one standalone Redis keyspace. Redis
   * Sentinel and Redis Cluster are not supported by the built-in adapter.
   */
  url?: string;
  /** Redis hostname */
  hostname?: string;
  /** Redis port */
  port?: number;
  /** Base key prefix; the backend appends its versioned storage-schema namespace. */
  prefix?: string;
  /** Base stream name for the job queue; the backend appends its storage-schema version. */
  streamKey?: string;
  /** Base consumer group name; the backend appends its storage-schema version. */
  groupName?: string;
  /** Consumer name (unique per worker) */
  consumerName?: string;
  /**
   * Run retention horizon in whole seconds. Positive values expire the run
   * hash and cap checkpoints and approvals at the same absolute horizon; index
   * metadata is removed by targeted lazy cleanup after the deadline. Omit or
   * use `0` to retain runs until explicit deletion. Negative, fractional, and
   * unrepresentable values are rejected during construction.
   */
  runTtl?: number;
  /** Enable debug logging */
  debug?: boolean;
  /**
   * Existing dedicated Redis client. Supplying it transfers ownership to this
   * backend; destroy() closes it and the caller must not reuse it elsewhere.
   */
  client?: RedisAdapter;
  /**
   * Maximum time in milliseconds for the native node-redis connection
   * attempt. Commands are not wrapped in synthetic Promise.race timeouts.
   */
  connectTimeoutMs?: number;
}

/**
 * Internal config type with required defaults
 */
export type RedisBackendInternalConfig =
  & Required<
    Pick<
      RedisBackendConfig,
      | "prefix"
      | "streamKey"
      | "groupName"
      | "consumerName"
      | "debug"
      | "connectTimeoutMs"
    >
  >
  & RedisBackendConfig;
