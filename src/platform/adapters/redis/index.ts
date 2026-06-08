/**
 * Redis Platform Adapters
 *
 * Runtime-agnostic Redis adapter interface and implementation.
 * Uses the npm `redis` client on both Deno and Node.js runtimes.
 *
 * @module platform/adapters/redis
 */

export type { NodeRedisClient, NodeRedisModule } from "./types.ts";
export type { RedisAdapter } from "./interface.ts";

export { NodeRedisAdapter } from "./node.ts";
export { clearModuleCache, getRedisModule } from "./modules.ts";
export { arrayToObject } from "./utils.ts";
