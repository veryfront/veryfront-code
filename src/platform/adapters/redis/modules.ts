import { isDeno } from "#veryfront/platform/compat/runtime.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { INITIALIZATION_ERROR } from "#veryfront/errors";
import {
  ensureRedisRuntimeProvider,
  getRegisteredRedisRuntimeProvider,
} from "#veryfront/extensions/distributed/defaults.ts";
import type { RedisRuntimeProvider } from "#veryfront/extensions/distributed/redis-runtime-provider.ts";
import type { NodeRedisModule } from "./types.ts";

interface PendingModuleLoad {
  readonly provider: Readonly<RedisRuntimeProvider>;
  readonly generation: number;
  readonly promise: Promise<{ NodeRedis: NodeRedisModule | null }>;
}

let moduleLoad: PendingModuleLoad | null = null;
let cacheGeneration = 0;

export function getRedisModule(): Promise<{
  NodeRedis: NodeRedisModule | null;
}> {
  return withSpan(
    "platform.redis.getModule",
    async () => {
      try {
        const provider = await ensureRedisRuntimeProvider();
        const generation = cacheGeneration;
        if (
          moduleLoad?.provider === provider &&
          moduleLoad.generation === generation
        ) {
          return await moduleLoad.promise;
        }

        const pending = provider.loadModule().then((loaded) => {
          const currentProvider = getRegisteredRedisRuntimeProvider();
          if (
            cacheGeneration !== generation ||
            currentProvider !== provider
          ) {
            throw new Error(
              "Redis runtime provider changed while its module was loading",
            );
          }
          return { NodeRedis: loaded };
        });
        const tracked = pending.finally(() => {
          if (moduleLoad?.promise === tracked) moduleLoad = null;
        });
        moduleLoad = { provider, generation, promise: tracked };
        return await tracked;
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
  );
}

/** Invalidate an in-flight provider module resolution. */
export function clearModuleCache(): void {
  cacheGeneration++;
  moduleLoad = null;
}
