/**
 * Redis Module Loader
 *
 * Lazy-loading of Redis client modules for Deno and Node.js runtimes.
 *
 * @module platform/adapters/redis/modules
 */

import { isDeno } from "@veryfront/platform/compat/runtime.ts";
import type { DenoRedisModule, NodeRedisModule } from "./types.ts";

// Cached Redis client modules (loaded only when Redis is used)
let DenoRedis: DenoRedisModule | null = null;
let NodeRedis: NodeRedisModule | null = null;

/**
 * Lazily load the Redis module for the current runtime.
 * This ensures the redis package is only required when Redis is actually used.
 *
 * NOTE: We construct module names dynamically to prevent Deno's static analyzer
 * from pre-fetching these optional dependencies during lint/check tasks.
 */
export async function getRedisModule(): Promise<{
  DenoRedis: DenoRedisModule | null;
  NodeRedis: NodeRedisModule | null;
}> {
  // Return cached modules if already loaded
  if (DenoRedis || NodeRedis) {
    return { DenoRedis, NodeRedis };
  }

  if (isDeno) {
    try {
      // Construct URL dynamically to prevent static analysis from pre-fetching
      const denoRedisUrl = ["https://deno.land/x/redis", "@v0.32.1/mod.ts"].join("");
      // @ts-ignore - Deno global
      DenoRedis = await import(denoRedisUrl);
    } catch (error) {
      throw new Error(
        `Failed to load Deno Redis module. Error: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  } else {
    try {
      // Construct module name dynamically to prevent Deno static analyzer
      // from trying to resolve this npm package during lint/check
      const redisModuleName = ["re", "dis"].join("");
      NodeRedis = await import(redisModuleName);
    } catch (error) {
      throw new Error(
        `Failed to load 'redis' package. Please install it with: npm install redis\n` +
          `Error: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return { DenoRedis, NodeRedis };
}

/**
 * Clear cached modules (for testing)
 */
export function clearModuleCache(): void {
  DenoRedis = null;
  NodeRedis = null;
}
