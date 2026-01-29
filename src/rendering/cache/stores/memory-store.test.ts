import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { MemoryCacheStore } from "./memory-store.ts";
import type { CachePayload } from "../types.ts";

function makePayload(html = "<p>test</p>"): CachePayload {
  return {
    result: { html, frontmatter: {} },
    storedAt: Date.now(),
  };
}

describe("rendering/cache/stores/memory-store", () => {
  describe("MemoryCacheStore", () => {
    it("should get and set values", async () => {
      const store = new MemoryCacheStore();
      const payload = makePayload();
      await store.set("key1", payload);
      const result = await store.get("key1");
      assertEquals(result?.result.html, "<p>test</p>");
    });

    it("should return undefined for missing keys", async () => {
      const store = new MemoryCacheStore();
      const result = await store.get("missing");
      assertEquals(result, undefined);
    });

    it("should delete entries", async () => {
      const store = new MemoryCacheStore();
      await store.set("key1", makePayload());
      await store.delete("key1");
      assertEquals(await store.get("key1"), undefined);
    });

    it("should delete by prefix", async () => {
      const store = new MemoryCacheStore();
      await store.set("proj:a:page1", makePayload("a1"));
      await store.set("proj:a:page2", makePayload("a2"));
      await store.set("proj:b:page1", makePayload("b1"));

      const deleted = await store.deleteByPrefix("proj:a:");
      assertEquals(deleted, 2);
      assertEquals(await store.get("proj:a:page1"), undefined);
      assertEquals(await store.get("proj:a:page2"), undefined);
      assertEquals((await store.get("proj:b:page1"))?.result.html, "b1");
    });

    it("should clear all entries", async () => {
      const store = new MemoryCacheStore();
      await store.set("a", makePayload());
      await store.set("b", makePayload());
      await store.clear();
      assertEquals(await store.get("a"), undefined);
      assertEquals(await store.get("b"), undefined);
    });

    it("should respect maxEntries option", async () => {
      const store = new MemoryCacheStore({ maxEntries: 2 });
      await store.set("a", makePayload("a"));
      await store.set("b", makePayload("b"));
      await store.set("c", makePayload("c"));
      // LRU eviction: 'a' should be evicted
      assertEquals(await store.get("a"), undefined);
      assertEquals((await store.get("c"))?.result.html, "c");
    });

    it("should destroy without error", async () => {
      const store = new MemoryCacheStore();
      await store.set("x", makePayload());
      await store.destroy();
    });
  });
});
