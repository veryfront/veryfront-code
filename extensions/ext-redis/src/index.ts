/** Explicit Redis implementation of Veryfront's distributed runtime contract. */

import type { ExtensionFactory } from "veryfront/extensions";
import { DistributedRuntimeProviderName } from "veryfront/extensions/distributed";
import type { RedisExtensionOptions } from "./connection-config.ts";
import { createRedisExtensionRuntime } from "./extension-factory.ts";

const extRedis = ((options: RedisExtensionOptions = {}) => {
  const runtime = createRedisExtensionRuntime(options);
  return {
    name: "ext-redis",
    version: "0.1.0",
    contracts: { provides: [DistributedRuntimeProviderName] },
    capabilities: [
      { type: "net:outbound", hosts: ["*"] },
      {
        type: "env:read",
        keys: ["NODE_ENV", "REDIS_PASSWORD", "REDIS_URL", "REDIS_USERNAME"],
      },
    ],
    setup: runtime.setup,
    teardown: runtime.teardown,
  };
}) satisfies (options?: RedisExtensionOptions) => ReturnType<ExtensionFactory>;

export default extRedis;
export { RedisMemory } from "./agent-memory.ts";
export { RedisCacheBackend } from "./cache-backend.ts";
export { RedisEventPublisher } from "./event-publisher.ts";
export { RedisRateLimitStore } from "./rate-limit-store.ts";
export { RedisCacheStore } from "./render-cache-store.ts";
export { RedisBackend } from "./workflow-backend.ts";
export type { RedisBackendConfig } from "./workflow-backend-types.ts";
export type { RedisExtensionOptions } from "./connection-config.ts";
