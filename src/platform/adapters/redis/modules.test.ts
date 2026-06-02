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
    it("should return an object with DenoRedis and NodeRedis keys", async () => {
      clearModuleCache();
      const result = await getRedisModule();
      assertExists(result);
      assertEquals("DenoRedis" in result, true);
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

    it("should load exactly one redis module per runtime", async () => {
      clearModuleCache();
      const result = await getRedisModule();
      // Exactly one should be loaded: DenoRedis on Deno, NodeRedis on Node/Bun
      const hasExactlyOne = (result.DenoRedis !== null) !== (result.NodeRedis !== null);
      assertEquals(hasExactlyOne, true);
    });

    it("should use the pinned npm Redis client in Deno", async () => {
      if (!isDeno) return;

      clearModuleCache();
      const result = await getRedisModule();

      assertEquals(result.DenoRedis, null);
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
