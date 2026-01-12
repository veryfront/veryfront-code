/**
 * Redis Platform Adapters
 *
 * Runtime-agnostic Redis adapter interface and implementations
 * for both Deno and Node.js runtimes.
 *
 * @module platform/adapters/redis
 */

// Types
export type {
  DenoRedisClient,
  DenoRedisModule,
  NodeRedisClient,
  NodeRedisModule,
} from "./types.ts";

// Interface
export type { RedisAdapter } from "./interface.ts";

// Adapters
export { DenoRedisAdapter } from "./deno.ts";
export { NodeRedisAdapter } from "./node.ts";

// Module loader
export { clearModuleCache, getRedisModule } from "./modules.ts";

// Utilities
export { arrayToObject } from "./utils.ts";
