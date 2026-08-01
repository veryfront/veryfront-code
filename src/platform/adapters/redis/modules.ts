import { isDeno } from "#veryfront/platform/compat/runtime.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { INITIALIZATION_ERROR } from "#veryfront/errors";
import { ensureRedisRuntimeProvider } from "#veryfront/extensions/distributed/defaults.ts";
import type { NodeRedisModule } from "./types.ts";

let NodeRedis: NodeRedisModule | null = null;
let moduleLoad: Promise<{ NodeRedis: NodeRedisModule | null }> | null = null;
let cacheGeneration = 0;

export function getRedisModule(): Promise<{
  NodeRedis: NodeRedisModule | null;
}> {
  if (NodeRedis) {
    return Promise.resolve({ NodeRedis });
  }
  if (moduleLoad) return moduleLoad;

  const generation = cacheGeneration;
  const pending = withSpan(
    "platform.redis.getModule",
    async () => {
      try {
        const provider = await ensureRedisRuntimeProvider();
        const loaded = await provider.loadModule();
        if (cacheGeneration === generation) NodeRedis = loaded;
        return { NodeRedis: loaded };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        throw INITIALIZATION_ERROR.create({
          detail:
            "Failed to load the Redis runtime. Install @veryfront/ext-redis alongside veryfront.\n" +
            `Error: ${message}`,
          cause: error instanceof Error ? error : undefined,
        });
      }
    },
    { "redis.runtime": isDeno ? "deno" : "node" },
  ).finally(() => {
    if (moduleLoad === pending) moduleLoad = null;
  });
  moduleLoad = pending;
  return pending;
}

export function clearModuleCache(): void {
  cacheGeneration++;
  NodeRedis = null;
  moduleLoad = null;
}
