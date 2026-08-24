import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { FakeTime } from "#std/testing/time";
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
      await store.set("key1", makePayload());
      assertEquals((await store.get("key1"))?.result.html, "<p>test</p>");
    });

    it("should return undefined for missing keys", async () => {
      const store = new MemoryCacheStore();
      assertEquals(await store.get("missing"), undefined);
    });

    it("should delete entries", async () => {
      const store = new MemoryCacheStore();
      await store.set("key1", makePayload());
      await store.delete("key1");
      assertEquals(await store.get("key1"), undefined);
    });

    it("should compare-delete without removing a replacement", async () => {
      const store = new MemoryCacheStore();
      const observed = makePayload("observed");
      const replacement = makePayload("replacement");
      await store.set("key1", observed);
      const read = await store.get("key1");
      await store.set("key1", replacement);

      assertEquals(await store.deleteIfUnchanged("key1", read!), false);
      assertEquals(await store.get("key1"), replacement);
      assertEquals(await store.deleteIfUnchanged("key1", replacement), true);
      assertEquals(await store.get("key1"), undefined);
    });

    it("should delete by prefix", async () => {
      const store = new MemoryCacheStore();
      await store.set("proj:a:page1", makePayload("a1"));
      await store.set("proj:a:page2", makePayload("a2"));
      await store.set("proj:b:page1", makePayload("b1"));

      assertEquals(await store.deleteByPrefix("proj:a:"), 2);
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

      assertEquals(await store.get("a"), undefined);
      assertEquals((await store.get("c"))?.result.html, "c");
    });

    it("does not apply store TTL when enforceStoreTtl is false", async () => {
      using time = new FakeTime();
      const store = new MemoryCacheStore({ ttlMs: 10, enforceStoreTtl: false });
      await store.set("k", makePayload());

      await time.tickAsync(1000);

      assertEquals(
        (await store.get("k"))?.result.html,
        "<p>test</p>",
        "enforceStoreTtl:false must suppress store-level TTL eviction",
      );
      await store.destroy();
    });

    it("should destroy without error", async () => {
      const store = new MemoryCacheStore();
      await store.set("x", makePayload());
      await store.destroy();
    });
  });
});
