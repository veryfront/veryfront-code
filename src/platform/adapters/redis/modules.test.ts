import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isDeno } from "#veryfront/platform/compat/runtime.ts";
import { VeryfrontError } from "#veryfront/errors";
import type { NodeRedisModule } from "./types.ts";
import { clearModuleCache, createRedisModuleCache, getRedisModule } from "./modules.ts";

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const validModule = { createClient: () => ({}) } as unknown as NodeRedisModule;

describe("platform/adapters/redis/modules", () => {
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

    it("should cache the result on subsequent calls", async () => {
      // First call loads the module
      const first = await getRedisModule();
      // Second call should return cached result immediately
      const second = await getRedisModule();
      assertExists(first);
      assertExists(second);
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

    it("should use the pinned npm Redis client in Deno", async () => {
      if (!isDeno) return;

      clearModuleCache();
      const result = await getRedisModule();

      assertExists(result.NodeRedis);
      assertEquals(typeof result.NodeRedis.createClient, "function");
    });
  });

  describe("isolated module cache", () => {
    it("sanitizes importer failures without retaining their cause", async () => {
      const privateFailure = "PRIVATE_REDIS_IMPORT_FAILURE";
      const cache = createRedisModuleCache(() => Promise.reject(new Error(privateFailure)));

      let caught: unknown;
      try {
        await cache.get();
      } catch (error) {
        caught = error;
      }

      assertExists(caught);
      assertEquals(caught instanceof VeryfrontError, true);
      const error = caught as VeryfrontError;
      assertEquals(error.slug, "initialization-error");
      assertEquals(error.message, "Veryfront could not initialize the Redis client.");
      assertEquals(error.cause, undefined);
      assertEquals(JSON.stringify(error).includes(privateFailure), false);
    });

    it("rejects hostile or malformed module namespaces with the same safe error", async () => {
      const privateFailure = "PRIVATE_REDIS_NAMESPACE_FAILURE";
      const namespace = Object.create(null);
      Object.defineProperty(namespace, "createClient", {
        get() {
          throw new Error(privateFailure);
        },
      });
      const cache = createRedisModuleCache(() => Promise.resolve(namespace));

      let caught: unknown;
      try {
        await cache.get();
      } catch (error) {
        caught = error;
      }

      assertExists(caught);
      assertEquals(caught instanceof VeryfrontError, true);
      const error = caught as VeryfrontError;
      assertEquals(error.message, "Veryfront could not initialize the Redis client.");
      assertEquals(error.cause, undefined);
      assertEquals(JSON.stringify(error).includes(privateFailure), false);
    });

    it("coalesces concurrent loads and shares the validated module", async () => {
      const load = deferred<unknown>();
      let calls = 0;
      const cache = createRedisModuleCache(() => {
        calls++;
        return load.promise;
      });

      const first = cache.get();
      const second = cache.get();
      assertEquals(calls, 1);
      load.resolve(validModule);

      assertStrictEquals(await first, validModule);
      assertStrictEquals(await second, validModule);
      assertStrictEquals(await cache.get(), validModule);
      assertEquals(calls, 1);
    });

    it("does not let a pre-clear load repopulate the cache", async () => {
      const firstLoad = deferred<unknown>();
      const secondLoad = deferred<unknown>();
      const secondModule = { createClient: () => ({ second: true }) } as unknown as NodeRedisModule;
      let calls = 0;
      const cache = createRedisModuleCache(() => {
        calls++;
        return calls === 1 ? firstLoad.promise : secondLoad.promise;
      });

      const stale = cache.get();
      cache.clear();
      const current = cache.get();
      assertEquals(calls, 2);

      firstLoad.resolve(validModule);
      assertStrictEquals(await stale, validModule);
      secondLoad.resolve(secondModule);
      assertStrictEquals(await current, secondModule);
      assertStrictEquals(await cache.get(), secondModule);
      assertEquals(calls, 2);
    });
  });

  describe("clearModuleCache", () => {
    it("should not throw", () => {
      clearModuleCache();
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
