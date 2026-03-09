import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { KVCacheStore } from "./kv-store.ts";

describe("rendering/cache/stores/kv-store", () => {
  describe("KVCacheStore constructor", () => {
    it("should create with default options", () => {
      const store = new KVCacheStore();
      assertEquals(store instanceof KVCacheStore, true);
    });

    it("should create with custom path", () => {
      const store = new KVCacheStore({ path: "/tmp/test.db" });
      assertEquals(store instanceof KVCacheStore, true);
    });
  });

  describe("operations with Deno KV", () => {
    it("should return undefined for get on nonexistent key", async () => {
      const store = new KVCacheStore();
      const result = await store.get("nonexistent-key-" + Date.now());
      assertEquals(result, undefined);
    });

    it("should handle delete on nonexistent key", async () => {
      const store = new KVCacheStore();
      await store.delete("nonexistent-key-" + Date.now());
    });

    it("should handle clear without error", async () => {
      const store = new KVCacheStore();
      await store.clear();
    });

    it("should handle deleteByPrefix without error", async () => {
      const store = new KVCacheStore();
      const deleted = await store.deleteByPrefix("nonexistent:");
      assertEquals(deleted >= 0, true);
    });

    it("should handle destroy without error", async () => {
      const store = new KVCacheStore();
      await store.destroy();
    });

    it("should return undefined after destroy", async () => {
      const store = new KVCacheStore();
      await store.destroy();
      const result = await store.get("key");
      assertEquals(result, undefined);
    });
  });
});
