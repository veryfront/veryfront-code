/**
 * Redis Platform Adapters
 *
 * Runtime-agnostic Redis adapter interface and implementations
 * for both Deno and Node.js runtimes.
 *
 * @module platform/adapters/redis
 */

export type {
  DenoRedisClient,
  DenoRedisModule,
  NodeRedisClient,
  NodeRedisModule,
} from "./types.ts";

export type { RedisAdapter } from "./interface.ts";

export { DenoRedisAdapter } from "./deno.ts";
export { NodeRedisAdapter } from "./node.ts";

export { clearModuleCache, getRedisModule } from "./modules.ts";

export { arrayToObject } from "./utils.ts";
