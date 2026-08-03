/**
 * ext-redis: third-party Redis runtime implementation for Veryfront.
 *
 * @module extensions/ext-redis
 */

import type { ExtensionFactory } from "veryfront/extensions/types";
import {
  type RedisRuntimeProvider,
  RedisRuntimeProviderName,
} from "veryfront/extensions/distributed";
import { createRedisRuntimeProvider } from "./redis-runtime-provider.ts";

const extRedis: ExtensionFactory = () => {
  let provider: RedisRuntimeProvider | undefined;

  return {
    name: "ext-redis",
    version: "0.1.0",
    contracts: { provides: [RedisRuntimeProviderName] },
    capabilities: [
      { type: "net:outbound", hosts: ["*"] },
      {
        type: "env:read",
        keys: ["NODE_ENV", "REDIS_PASSWORD", "REDIS_URL", "REDIS_USERNAME"],
      },
    ],
    async setup(ctx) {
      if (provider) throw new Error("ext-redis is already active");
      const nextProvider = createRedisRuntimeProvider();
      try {
        ctx.provide(RedisRuntimeProviderName, nextProvider);
      } catch (error) {
        await nextProvider.close();
        throw error;
      }
      provider = nextProvider;
      try {
        ctx.logger.info(`[ext-redis] ${RedisRuntimeProviderName} registered`);
      } catch {
        // Diagnostics must not invalidate a successfully registered provider.
      }
    },
    async teardown() {
      if (!provider) return;
      const retiring = provider;
      await retiring.close();
      if (provider === retiring) provider = undefined;
    },
  };
};

export default extRedis;
export { RedisMemory } from "./agent-memory.ts";
export { createRedisCacheAdministration } from "./cache-administration.ts";
export { RedisCacheBackend } from "./cache-backend.ts";
export { type RedisRateLimitOptions, RedisRateLimitStore } from "./rate-limit-store.ts";
export { RedisCacheStore } from "./render-cache-store.ts";
export { startProxyRoutingInvalidationBus } from "./routing-invalidation-bus.ts";
export { createRedisRuntimeProvider } from "./redis-runtime-provider.ts";
export type {
  RedisClient,
  RedisClientOptions,
  RedisEventPublisherConfig,
  RedisEventPublisherImplementation,
  RedisRuntimeProvider,
} from "veryfront/extensions/distributed";
