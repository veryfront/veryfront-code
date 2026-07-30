/** Explicit Redis implementation of Veryfront's distributed runtime contract. */

import { createClient } from "redis";
import type { ExtensionFactory } from "veryfront/extensions";
import type {
  DistributedAgentMemoryOptions,
  DistributedRuntimeProvider,
} from "veryfront/extensions/distributed";
import type { MinimalMessage } from "veryfront/extensions/distributed/agent-memory-support";
import { DistributedRuntimeProviderName } from "veryfront/extensions/distributed";
import { type RedisClient as RedisMemoryClient, RedisMemory } from "./agent-memory.ts";
import { createRedisCacheAdministration } from "./cache-administration.ts";
import { RedisCacheBackend } from "./cache-backend.ts";
import {
  captureRedisConnectionPolicy,
  type RedisExtensionOptions,
  resolveRedisUrl,
} from "./connection-config.ts";
import { RedisEventPublisher } from "./event-publisher.ts";
import { RedisRateLimitStore } from "./rate-limit-store.ts";
import { RedisCacheStore } from "./render-cache-store.ts";
import { createRedisClientManager, type RedisClientManager } from "./redis-client-manager.ts";
import { startProxyRoutingInvalidationBus } from "./routing-invalidation-bus.ts";
import { RedisBackend } from "./workflow-backend.ts";

const PROVIDER_ID = "redis@5.11.0";

interface CloseableResource {
  close(): void | Promise<void>;
}

function createLazyAgentClient(
  endpoint: string,
  own: (resource: CloseableResource) => void,
): RedisMemoryClient {
  const client = createClient({ url: endpoint });
  let connection: Promise<unknown> | undefined;
  const ready = () => connection ??= client.connect();
  own({ close: () => connection ? client.close() : Promise.resolve() });

  return {
    async get(key) {
      await ready();
      return await client.get(key);
    },
    async set(key, value, options) {
      await ready();
      return await client.set(key, value, options);
    },
    async del(key) {
      await ready();
      return await client.del(key);
    },
    async expire(key, seconds) {
      await ready();
      return await client.expire(key, seconds);
    },
    async sendCommand(args) {
      await ready();
      return await client.sendCommand(args);
    },
  };
}

const extRedis = ((options: RedisExtensionOptions = {}) => {
  const connectionPolicy = captureRedisConnectionPolicy(options);
  let active = false;
  let sharedManager: RedisClientManager | undefined;
  let resources: CloseableResource[] = [];
  let teardownPromise: Promise<void> | undefined;

  const requireActive = () => {
    if (!active) throw new Error("ext-redis is not active");
  };
  const own = (resource: CloseableResource) => {
    requireActive();
    resources.push(resource);
  };
  const managerClientOptions = () => ({
    url: connectionPolicy.url,
    connectTimeout: connectionPolicy.connectTimeoutMs,
  });
  const requireUrl = () => resolveRedisUrl(connectionPolicy);

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
    setup(ctx) {
      if (active) throw new Error("ext-redis is already active");
      if (teardownPromise || resources.length > 0 || sharedManager) {
        throw new Error("ext-redis requires successful teardown before setup");
      }
      active = true;
      sharedManager = createRedisClientManager();
      resources = [];

      const provider: DistributedRuntimeProvider = {
        id: PROVIDER_ID,
        async createCacheBackend(options) {
          requireActive();
          const backend = new RedisCacheBackend(options.keyPrefix, {
            clientManager: sharedManager,
            clientOptions: managerClientOptions(),
          });
          if (!await backend.initialize()) {
            throw new Error("Redis distributed cache backend could not be initialized");
          }
          return backend;
        },
        createRenderCacheStore(options) {
          requireActive();
          const store = new RedisCacheStore({
            url: requireUrl(),
            connectTimeoutMs: connectionPolicy.connectTimeoutMs,
            keyPrefix: options.keyPrefix,
            ttlSeconds: options.ttlSeconds,
            clientManager: sharedManager,
          });
          own({ close: () => store.destroy() });
          return store;
        },
        createWorkflowBackend(options) {
          requireActive();
          const backend = new RedisBackend({
            url: requireUrl(),
            prefix: options.prefix,
            streamKey: options.streamKey,
            groupName: options.groupName,
            consumerName: options.consumerName,
            runTtl: options.runTtlSeconds,
            debug: options.debug,
          });
          own({ close: () => backend.destroy() });
          return backend;
        },
        getWorkflowWorkerEnvironment() {
          requireActive();
          return { REDIS_URL: requireUrl() };
        },
        createRateLimitStore(options) {
          requireActive();
          const store = new RedisRateLimitStore({
            url: requireUrl(),
            keyPrefix: options.keyPrefix,
            connectTimeoutMs: connectionPolicy.connectTimeoutMs,
            operationTimeoutMs: options.operationTimeoutMs ?? connectionPolicy.operationTimeoutMs,
          });
          own({ close: () => store.destroy() });
          return store;
        },
        createAgentMemory<M extends MinimalMessage>(
          agentId: string,
          options: DistributedAgentMemoryOptions,
        ) {
          requireActive();
          const client = createLazyAgentClient(requireUrl(), own);
          return new RedisMemory<M>(agentId, {
            type: "redis",
            client,
            keyPrefix: options.keyPrefix,
            userId: options.userId,
            ttl: options.ttlSeconds,
            maxMessages: options.maxMessages,
            maxTokens: options.maxTokens,
          });
        },
        createEventPublisher(options) {
          requireActive();
          const publisher = new RedisEventPublisher({
            url: requireUrl(),
            channelPrefix: options.channelPrefix,
            debug: options.debug,
          });
          own({ close: () => publisher.close() });
          return publisher;
        },
        async startRoutingInvalidationBus(options) {
          requireActive();
          const bus = await startProxyRoutingInvalidationBus({
            redisUrl: requireUrl(),
            acknowledgementTimeoutMs: options.acknowledgementTimeoutMs,
            expectedReplicas: options.expectedReplicas,
            integritySecret: options.integritySecret,
            logger: options.logger,
            onInvalidate: options.onInvalidate,
            replicaId: options.replicaId,
          });
          if (!bus) {
            throw new Error("Redis routing invalidation could not be initialized");
          }
          try {
            own({ close: () => bus.close() });
          } catch (error) {
            await bus.close();
            throw error;
          }
          return bus;
        },
        getCacheAdministration() {
          requireActive();
          return createRedisCacheAdministration(sharedManager!, managerClientOptions());
        },
      };

      try {
        ctx.provide(DistributedRuntimeProviderName, provider);
      } catch (error) {
        active = false;
        sharedManager = undefined;
        resources = [];
        throw error;
      }
      try {
        ctx.logger.info(`[ext-redis] ${DistributedRuntimeProviderName} registered`);
      } catch {
        // Diagnostics must not invalidate a successfully registered provider.
      }
    },
    teardown() {
      if (teardownPromise) return teardownPromise;
      if (!active && resources.length === 0 && !sharedManager) return Promise.resolve();
      active = false;
      const manager = sharedManager;
      sharedManager = undefined;
      const retiring: CloseableResource[] = [
        ...resources.reverse(),
        ...(manager ? [{ close: () => manager.disconnect() }] : []),
      ];
      resources = [];

      const teardown = (async () => {
        const results = await Promise.allSettled(
          retiring.map((resource) => Promise.resolve().then(() => resource.close())),
        );
        const failedResources: CloseableResource[] = [];
        const failures: unknown[] = [];
        for (let index = 0; index < results.length; index++) {
          const result = results[index]!;
          if (result.status === "rejected") {
            failedResources.push(retiring[index]!);
            failures.push(result.reason);
          }
        }
        resources = failedResources;
        if (failures.length === 1) throw failures[0];
        if (failures.length > 1) {
          throw new AggregateError(failures, "ext-redis teardown failed");
        }
      })().finally(() => {
        if (teardownPromise === teardown) teardownPromise = undefined;
      });
      teardownPromise = teardown;
      return teardown;
    },
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
