import { isDeno } from "#veryfront/platform/compat/runtime.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { INITIALIZATION_ERROR } from "#veryfront/errors";
import type { NodeRedisModule } from "./types.ts";

interface LoadedRedisModule {
  NodeRedis: NodeRedisModule;
}

let cachedNodeRedis: NodeRedisModule | null = null;
let pendingModuleLoad: Promise<LoadedRedisModule> | null = null;
let moduleCacheGeneration = 0;

async function loadRedisModule(): Promise<NodeRedisModule> {
  try {
    const candidate: unknown = isDeno ? await import("npm:redis@5.11.0") : await import("redis");
    if (
      typeof candidate !== "object" ||
      candidate === null ||
      typeof (candidate as { createClient?: unknown }).createClient !== "function"
    ) {
      throw new TypeError("Redis package does not export createClient()");
    }
    return candidate as NodeRedisModule;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const packageName = isDeno ? "npm:redis@5.11.0" : "redis";

    throw INITIALIZATION_ERROR.create({
      detail:
        `Failed to load '${packageName}' package. Ensure the Redis dependency is installed and resolvable.\nError: ${message}`,
      cause: error instanceof Error ? error : undefined,
    });
  }
}

export function getRedisModule(): Promise<LoadedRedisModule> {
  if (cachedNodeRedis) {
    return Promise.resolve({ NodeRedis: cachedNodeRedis });
  }
  if (pendingModuleLoad) return pendingModuleLoad;

  const loadGeneration = moduleCacheGeneration;
  const load = withSpan(
    "platform.redis.getModule",
    async () => {
      const NodeRedis = await loadRedisModule();
      if (loadGeneration === moduleCacheGeneration) {
        cachedNodeRedis = NodeRedis;
      }
      return { NodeRedis };
    },
    { "redis.runtime": isDeno ? "deno" : "node" },
  );

  const trackedLoad = load.finally(() => {
    if (pendingModuleLoad === trackedLoad) pendingModuleLoad = null;
  });
  pendingModuleLoad = trackedLoad;
  return trackedLoad;
}

export function clearModuleCache(): void {
  moduleCacheGeneration++;
  cachedNodeRedis = null;
  pendingModuleLoad = null;
}
