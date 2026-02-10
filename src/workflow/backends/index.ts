/**
 * @module
 * Workflow Backend Exports
 */

export type { BackendConfig, Lock, WorkflowBackend } from "./types.ts";
export { hasEventSupport, hasLockSupport, hasQueueSupport } from "./types.ts";

export { MemoryBackend } from "./memory.ts";

export { RedisBackend } from "./redis.ts";
export type { RedisBackendConfig } from "./redis.ts";
