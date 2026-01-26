import type { RuntimeAdapter } from "../../platform/adapters/base.js";

export interface HMRServerOptions {
  port: number;
  projectDir: string;
  reactRefresh?: boolean;
  adapter: RuntimeAdapter;
  maxMessageSize?: number;
  maxMessagesPerMinute?: number;
  signal?: AbortSignal;
}

export interface HMRUpdate {
  type: "update" | "reload";
  path?: string;
  timestamp?: number;
}

export interface WebSocketContext {
  clients: Set<WebSocket>;
  rateLimiter: RateLimiter;
  maxMessageSize: number;
  reactRefresh?: boolean;
}

export interface RateLimiter {
  check(socket: WebSocket): boolean;
  cleanup(socket: WebSocket): void;
}
