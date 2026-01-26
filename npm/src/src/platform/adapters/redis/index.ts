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
} from "./types.js";

export type { RedisAdapter } from "./interface.js";

export { DenoRedisAdapter } from "./deno.js";
export { NodeRedisAdapter } from "./node.js";

export { clearModuleCache, getRedisModule } from "./modules.js";

export { arrayToObject } from "./utils.js";
