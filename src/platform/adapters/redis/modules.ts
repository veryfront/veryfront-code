import { isDeno } from "#veryfront/platform/compat/runtime.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import type { DenoRedisModule, NodeRedisModule } from "./types.ts";

let DenoRedis: DenoRedisModule | null = null;
let NodeRedis: NodeRedisModule | null = null;

export function getRedisModule(): Promise<{
  DenoRedis: DenoRedisModule | null;
  NodeRedis: NodeRedisModule | null;
}> {
  if (DenoRedis || NodeRedis) {
    return Promise.resolve({ DenoRedis, NodeRedis });
  }

  return withSpan(
    "platform.redis.getModule",
    async () => {
      try {
        if (isDeno) {
          const denoRedisUrl = "https://deno.land/x/redis@v0.32.1/mod.ts";
          // @ts-ignore - Deno global
          DenoRedis = await import(denoRedisUrl);
        } else {
          NodeRedis = (await import("redis")) as unknown as NodeRedisModule;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        if (isDeno) {
          throw new Error(`Failed to load Deno Redis module. Error: ${message}`);
        }

        throw new Error(
          `Failed to load 'redis' package. Please install it with: npm install redis\nError: ${message}`,
        );
      }

      return { DenoRedis, NodeRedis };
    },
    { "redis.runtime": isDeno ? "deno" : "node" },
  );
}

export function clearModuleCache(): void {
  DenoRedis = null;
  NodeRedis = null;
}
