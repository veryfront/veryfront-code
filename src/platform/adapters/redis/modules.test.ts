import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isDeno } from "#veryfront/platform/compat/runtime.ts";
import { clearModuleCache, getRedisModule } from "./modules.ts";

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
