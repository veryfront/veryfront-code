import { isDeno } from "#veryfront/platform/compat/runtime.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { INITIALIZATION_ERROR } from "#veryfront/errors";
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
          NodeRedis = (await import("npm:redis@5.11.0")) as unknown as NodeRedisModule;
        } else {
          NodeRedis = (await import("redis")) as unknown as NodeRedisModule;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const packageName = isDeno ? "npm:redis@5.11.0" : "redis";

        throw INITIALIZATION_ERROR.create({
          detail:
            `Failed to load '${packageName}' package. Please install it with: npm install redis\nError: ${message}`,
          cause: error instanceof Error ? error : undefined,
        });
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
