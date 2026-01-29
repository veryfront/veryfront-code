/**
 * Workflow Backend Exports
 */

export type { BackendConfig, Lock, WorkflowBackend } from "./types.ts";
export { hasEventSupport, hasLockSupport, hasQueueSupport } from "./types.ts";

export { MemoryBackend } from "./memory.ts";

export { RedisBackend } from "./redis.ts";
export type { RedisBackendConfig } from "./redis.ts";

// Stub workflow backends (Temporal, Inngest, Cloudflare) removed — they were
// never implemented beyond "not implemented" stubs and had zero consumers.
// See P2-2 Dead Export Audit in IMPLEMENTATION_PLAN.md.
