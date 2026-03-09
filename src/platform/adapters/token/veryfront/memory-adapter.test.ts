import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { MemoryTokenAdapter } from "./memory-adapter.ts";

describe("platform/adapters/token/veryfront/memory-adapter", () => {
  function createAdapter(): MemoryTokenAdapter {
    const adapter = new MemoryTokenAdapter();
    adapter.clear();
    return adapter;
  }

  describe("initialize", () => {
    it("should resolve immediately", async () => {
      const adapter = createAdapter();
      await adapter.initialize();
    });
  });

  describe("get/set", () => {
    it("should return null for missing key", async () => {
      const adapter = createAdapter();
      assertEquals(await adapter.get("nonexistent"), null);
    });

    it("should store and retrieve a value", async () => {
      const adapter = createAdapter();
      await adapter.set("key1", "value1");
      assertEquals(await adapter.get("key1"), "value1");
    });

    it("should overwrite existing value", async () => {
      const adapter = createAdapter();
      await adapter.set("key1", "old");
      await adapter.set("key1", "new");
      assertEquals(await adapter.get("key1"), "new");
    });

    it("should store empty string value", async () => {
      const adapter = createAdapter();
      await adapter.set("empty", "");
      assertEquals(await adapter.get("empty"), "");
    });
  });

  describe("delete", () => {
    it("should delete an existing key", async () => {
      const adapter = createAdapter();
      await adapter.set("key1", "value1");
      await adapter.delete("key1");
      assertEquals(await adapter.get("key1"), null);
    });

    it("should be idempotent for missing key", async () => {
      const adapter = createAdapter();
      await adapter.delete("nonexistent");
      // Should not throw
    });
  });

  describe("list", () => {
    it("should return all keys when no prefix", async () => {
      const adapter = createAdapter();
      await adapter.set("a:1", "v1");
      await adapter.set("b:2", "v2");
      const keys = await adapter.list();
      assertEquals(keys.length, 2);
      assertEquals(keys.includes("a:1"), true);
      assertEquals(keys.includes("b:2"), true);
    });

    it("should filter keys by prefix", async () => {
      const adapter = createAdapter();
      await adapter.set("user:1", "v1");
      await adapter.set("user:2", "v2");
      await adapter.set("admin:1", "v3");
      const keys = await adapter.list("user:");
      assertEquals(keys.length, 2);
      assertEquals(keys.every((k) => k.startsWith("user:")), true);
    });

    it("should return empty array when no keys match prefix", async () => {
      const adapter = createAdapter();
      await adapter.set("a:1", "v1");
      assertEquals(await adapter.list("zzz:"), []);
    });

    it("should return empty array when storage is empty", async () => {
      const adapter = createAdapter();
      assertEquals(await adapter.list(), []);
    });
  });

  describe("size", () => {
    it("should return 0 for empty storage", () => {
      const adapter = createAdapter();
      assertEquals(adapter.size, 0);
    });

    it("should reflect the number of stored items", async () => {
      const adapter = createAdapter();
      await adapter.set("a", "1");
      await adapter.set("b", "2");
      assertEquals(adapter.size, 2);
    });
  });

  describe("clear", () => {
    it("should remove all entries", async () => {
      const adapter = createAdapter();
      await adapter.set("a", "1");
      await adapter.set("b", "2");
      adapter.clear();
      assertEquals(adapter.size, 0);
      assertEquals(await adapter.get("a"), null);
    });
  });

  describe("dispose", () => {
    it("should not throw", () => {
      const adapter = createAdapter();
      adapter.dispose();
    });
  });
});
