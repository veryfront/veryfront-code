import { isDeno } from "#veryfront/platform/compat/runtime.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { INITIALIZATION_ERROR } from "#veryfront/errors/error-registry/general.ts";
import type { NodeRedisModule } from "./types.ts";

type RedisModuleImporter = () => Promise<unknown>;

export interface RedisModuleCache {
  get(): Promise<NodeRedisModule>;
  clear(): void;
}

function initializationError() {
  return INITIALIZATION_ERROR.create({
    message: "Veryfront could not initialize the Redis client.",
    detail: "Install the Redis client with: npm install redis",
    context: { component: "redis", reason: "module-load-failed" },
  });
}

function validateRedisModule(value: unknown): NodeRedisModule {
  try {
    if ((typeof value !== "object" && typeof value !== "function") || value === null) {
      throw new TypeError("Invalid module namespace");
    }
    if (typeof Reflect.get(value, "createClient") !== "function") {
      throw new TypeError("Missing createClient export");
    }
    return value as NodeRedisModule;
  } catch {
    throw initializationError();
  }
}

/** @internal Create an isolated, generation-safe Redis module cache. */
export function createRedisModuleCache(importModule: RedisModuleImporter): RedisModuleCache {
  let cached: NodeRedisModule | null = null;
  let pending: Promise<NodeRedisModule> | null = null;
  let generation = 0;

  const load = async (): Promise<NodeRedisModule> => {
    try {
      return validateRedisModule(await importModule());
    } catch {
      throw initializationError();
    }
  };

  return {
    get(): Promise<NodeRedisModule> {
      if (cached) return Promise.resolve(cached);
      if (pending) return pending;

      const loadGeneration = generation;
      const request = load().then(
        (module) => {
          if (generation === loadGeneration) {
            cached = module;
            pending = null;
          }
          return module;
        },
        (error: unknown) => {
          if (generation === loadGeneration) pending = null;
          throw error;
        },
      );
      pending = request;
      return request;
    },

    clear(): void {
      generation++;
      cached = null;
      pending = null;
    },
  };
}

const moduleCache = createRedisModuleCache(() =>
  isDeno ? import("npm:redis@5.11.0") : import("redis")
);

export function getRedisModule(): Promise<{ NodeRedis: NodeRedisModule }> {
  return withSpan(
    "platform.redis.getModule",
    async () => ({ NodeRedis: await moduleCache.get() }),
    { "redis.runtime": isDeno ? "deno" : "node" },
  );
}

export function clearModuleCache(): void {
  moduleCache.clear();
}
