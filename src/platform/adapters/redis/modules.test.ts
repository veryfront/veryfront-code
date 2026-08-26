import "#veryfront/schemas/_test-setup.ts";
import { createRedisRuntimeProvider } from "@veryfront/ext-redis";
import { register, unregister } from "#veryfront/extensions/contracts.ts";
import {
  type NodeRedisModule,
  type RedisRuntimeProvider,
  RedisRuntimeProviderName,
} from "#veryfront/extensions/distributed";
import {
  assertEquals,
  assertExists,
  assertNotEquals,
  assertRejects,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
import { VeryfrontError } from "#veryfront/errors/types.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { isDeno } from "#veryfront/platform/compat/runtime.ts";
import { clearModuleCache, getRedisModule } from "./modules.ts";

describe("platform/adapters/redis/modules", () => {
  let provider: RedisRuntimeProvider;

  beforeEach(() => {
    provider = createRedisRuntimeProvider();
    register(RedisRuntimeProviderName, provider);
    clearModuleCache();
  });

  afterEach(async () => {
    clearModuleCache();
    unregister(RedisRuntimeProviderName);
    await provider.close();
  });

  describe("clearModuleCache", () => {
    it("should not throw", () => {
      clearModuleCache();
    });
  });

  describe("getRedisModule", () => {
    it("should return an object with a NodeRedis key", async () => {
      clearModuleCache();
      const result = await getRedisModule();
      assertExists(result);
      assertEquals("NodeRedis" in result, true);
    });

    it("should revalidate the active provider on subsequent calls", async () => {
      const first = await getRedisModule();
      const second = await getRedisModule();
      assertExists(first);
      assertExists(second);
    });

    it("should stop using a module after its provider is unregistered", async () => {
      await getRedisModule();
      unregister(RedisRuntimeProviderName);

      const error = await assertRejects(
        () => getRedisModule(),
        VeryfrontError,
        "Missing extension",
      ) as VeryfrontError;
      assertEquals(
        error.slug,
        "initialization-error",
        "a failed Redis runtime load must be classified as INITIALIZATION_ERROR",
      );
      assertStringIncludes(
        error.message,
        "Install @veryfront/ext-redis alongside veryfront",
        "the failure must carry the extension install guidance",
      );
    });

    it("should resolve a replacement provider instead of returning the previous module", async () => {
      const first = await getRedisModule();
      const replacement = createRedisRuntimeProvider();
      register(RedisRuntimeProviderName, replacement);
      try {
        const second = await getRedisModule();
        assertNotEquals(second.NodeRedis, first.NodeRedis);
      } finally {
        unregister(RedisRuntimeProviderName);
        await replacement.close();
      }
    });

    it("should reject a stale module load when the provider changes in flight", async () => {
      const delayedProvider = createRedisRuntimeProvider();
      const delayedModule = await delayedProvider.loadModule();
      let markLoadStarted: (() => void) | undefined;
      const loadStarted = new Promise<void>((resolve) => {
        markLoadStarted = resolve;
      });
      let releaseModule: ((module: NodeRedisModule) => void) | undefined;
      const moduleGate = new Promise<NodeRedisModule>((resolve) => {
        releaseModule = resolve;
      });
      const deferredProvider: RedisRuntimeProvider = {
        ...delayedProvider,
        loadModule() {
          markLoadStarted?.();
          return moduleGate;
        },
      };
      const replacement = createRedisRuntimeProvider();
      register(RedisRuntimeProviderName, deferredProvider);

      try {
        const staleLoad = getRedisModule();
        await loadStarted;
        register(RedisRuntimeProviderName, replacement);

        const current = await getRedisModule();
        releaseModule?.(delayedModule);

        assertExists(current.NodeRedis);
        await assertRejects(
          () => staleLoad,
          Error,
          "provider changed while its module was loading",
        );
      } finally {
        unregister(RedisRuntimeProviderName);
        await Promise.all([delayedProvider.close(), replacement.close()]);
      }
    });

    it("should reject after the registered provider has closed", async () => {
      await getRedisModule();
      await provider.close();

      await assertRejects(
        () => getRedisModule(),
        Error,
        "provider is closed",
      );
    });

    it("should return fresh result after clearModuleCache", async () => {
      await getRedisModule();
      clearModuleCache();
      const result = await getRedisModule();
      assertExists(result);
    });

    it("should load the npm redis module on every runtime", async () => {
      clearModuleCache();
      const result = await getRedisModule();
      // The npm `redis` client is loaded into NodeRedis on both Deno and Node/Bun.
      assertExists(result.NodeRedis);
    });

    it("should preserve Pub/Sub and error-listener methods on module clients", async () => {
      const { NodeRedis } = await getRedisModule();
      assertExists(NodeRedis);

      const client = NodeRedis.createClient({});

      assertEquals(typeof client.publish, "function");
      assertEquals(typeof client.subscribe, "function");
      assertEquals(typeof client.unsubscribe, "function");
      assertEquals(typeof client.on, "function");
      assertEquals(typeof client.scan, "function");
    });

    it("should use the pinned npm Redis client in Deno", async () => {
      if (!isDeno) return;

      clearModuleCache();
      const result = await getRedisModule();

      assertExists(result.NodeRedis);
      assertEquals(typeof result.NodeRedis.createClient, "function");
    });
  });

  describe("clearModuleCache", () => {
    it("should not throw", () => {
      clearModuleCache();
    });

    it("rejects an in-flight module load that was invalidated by clearModuleCache", async () => {
      const deferredBase = createRedisRuntimeProvider();
      const deferredModule = await deferredBase.loadModule();
      let markLoadStarted: (() => void) | undefined;
      const loadStarted = new Promise<void>((resolve) => {
        markLoadStarted = resolve;
      });
      let releaseModule: ((module: NodeRedisModule) => void) | undefined;
      const moduleGate = new Promise<NodeRedisModule>((resolve) => {
        releaseModule = resolve;
      });
      const deferredProvider: RedisRuntimeProvider = {
        ...deferredBase,
        loadModule() {
          markLoadStarted?.();
          return moduleGate;
        },
      };
      register(RedisRuntimeProviderName, deferredProvider);

      try {
        const staleLoad = getRedisModule();
        await loadStarted;
        clearModuleCache();
        releaseModule?.(deferredModule);

        await assertRejects(
          () => staleLoad,
          Error,
          "provider changed while its module was loading",
          "clearModuleCache must invalidate an in-flight provider module resolution",
        );
        assertExists(
          (await getRedisModule()).NodeRedis,
          "a load started after the clear must still resolve",
        );
      } finally {
        unregister(RedisRuntimeProviderName);
        await deferredBase.close();
      }
    });

    it("should allow reloading after clear", async () => {
      const first = await getRedisModule();
      clearModuleCache();
      const second = await getRedisModule();
      assertExists(first);
      assertExists(second);
    });
  });
});
