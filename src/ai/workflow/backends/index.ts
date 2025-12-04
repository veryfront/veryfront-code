/**
 * Workflow Backend Exports
 */

// Types and interfaces
export type { BackendConfig, Lock, WorkflowBackend } from "./types.ts";
export { hasEventSupport, hasLockSupport, hasQueueSupport } from "./types.ts";

// Backend implementations
export { MemoryBackend } from "./memory.ts";

// Redis backend (production)
export { RedisBackend } from "./redis.ts";
export type { RedisBackendConfig, RedisClient } from "./redis.ts";

// Adapter backends (for external workflow engines)
export { TemporalAdapter } from "./temporal.ts";
export type { TemporalAdapterConfig } from "./temporal.ts";

export { InngestAdapter } from "./inngest.ts";
export type { InngestAdapterConfig } from "./inngest.ts";

export { CloudflareAdapter } from "./cloudflare.ts";
export type { CloudflareAdapterConfig } from "./cloudflare.ts";
