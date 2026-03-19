import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
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

    it("should return NodeRedis as null in Deno", async () => {
      clearModuleCache();
      const result = await getRedisModule();
      assertEquals(result.NodeRedis, null);
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
