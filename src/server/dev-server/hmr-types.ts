/**
 * HMR Type Definitions
 * Shared types for Hot Module Replacement functionality
 */

import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";

/**
 * Configuration options for the HMR server
 */
export interface HMRServerOptions {
  port: number;
  projectDir: string;
  reactRefresh?: boolean;
  adapter?: RuntimeAdapter;
  maxMessageSize?: number;
  maxMessagesPerMinute?: number;
  signal?: AbortSignal;
}

/**
 * HMR update message sent to clients
 */
export interface HMRUpdate {
  type: "update" | "reload";
  path?: string;
  timestamp?: number;
}

/**
 * WebSocket context for handler functions
 */
export interface WebSocketContext {
  clients: Set<WebSocket>;
  rateLimiter: RateLimiter;
  maxMessageSize: number;
  reactRefresh?: boolean;
}

/**
 * Rate limiter interface for WebSocket connections
 */
export interface RateLimiter {
  check(socket: WebSocket): boolean;
  cleanup(socket: WebSocket): void;
}
