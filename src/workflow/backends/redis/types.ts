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
  /** Base key prefix; the backend appends its versioned storage-schema namespace. */
  prefix?: string;
  /** Base stream name for the job queue; the backend appends its storage-schema version. */
  streamKey?: string;
  /** Base consumer group name; the backend appends its storage-schema version. */
  groupName?: string;
  /** Consumer name (unique per worker) */
  consumerName?: string;
  /**
   * @deprecated No-op retained for source compatibility.
   *
   * Creation-time expiry can remove an active or waiting run while leaving its
   * checkpoints, approvals, and shared index memberships behind. After an
   * upgrade, call `RedisBackend.clearLegacyRunTtlExpirations()` before removing
   * this option. Call `RedisBackend.deleteRun()` only after your application has
   * made the run ineligible for retry or resume.
   */
  runTtl?: number;
  /** Enable debug logging */
  debug?: boolean;
  /**
   * Reject context values that JSON would encode lossily instead of warning
   * and storing their normalized JSON form. Runtimes without hook-free Proxy
   * identification reject object and array context values when enabled.
   */
  strictContext?: boolean;
  /** Existing Redis client (optional) */
  client?: RedisAdapter;
}

/**
 * Internal config type with required defaults
 */
export type RedisBackendInternalConfig =
  & Required<
    Pick<
      RedisBackendConfig,
      "prefix" | "streamKey" | "groupName" | "consumerName" | "debug" | "strictContext"
    >
  >
  & RedisBackendConfig;
