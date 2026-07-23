import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { MemoryCacheStore } from "./memory-store.ts";
import type { CachePayload } from "../types.ts";

function makePayload(html = "<p>test</p>"): CachePayload {
  return {
    result: { html, frontmatter: {}, stream: null },
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

    it("stores and returns detached deep snapshots", async () => {
      const store = new MemoryCacheStore();
      const nestedFrontmatter = { seo: { title: "Original" } };
      const node = { tag: "h1", attrs: { className: "title" } };
      const payload: CachePayload = {
        result: {
          html: "<h1>Original</h1>",
          frontmatter: nestedFrontmatter as unknown as CachePayload["result"]["frontmatter"],
          headings: [{ id: "title", text: "Original", level: 1 }],
          nodeMap: new Map([[1, node]]),
          stream: null,
          pageModule: { slug: "index", code: "export default {}", type: "mdx" },
        },
        nodeMapEntries: [[1, node]],
        storedAt: Date.now(),
      };

      await store.set("snapshot", payload);
      nestedFrontmatter.seo.title = "Mutated input";
      node.attrs.className = "mutated-input";

      const first = await store.get("snapshot");
      assertEquals(
        (first?.result.frontmatter as unknown as { seo: { title: string } }).seo.title,
        "Original",
      );
      assertEquals(
        (first?.result.nodeMap?.get(1) as { attrs: { className: string } }).attrs.className,
        "title",
      );
      assertEquals(first?.result.stream, null);

      (first?.result.frontmatter as unknown as { seo: { title: string } }).seo.title =
        "Mutated output";
      (first?.result.nodeMap?.get(1) as { attrs: { className: string } }).attrs.className =
        "mutated-output";
      if (first?.result.headings?.[0]) first.result.headings[0].text = "Mutated output";
      if (first?.result.pageModule) first.result.pageModule.code = "mutated-output";

      const second = await store.get("snapshot");
      assertEquals(
        (second?.result.frontmatter as unknown as { seo: { title: string } }).seo.title,
        "Original",
      );
      assertEquals(
        (second?.result.nodeMap?.get(1) as { attrs: { className: string } }).attrs.className,
        "title",
      );
      assertEquals(second?.result.headings?.[0]?.text, "Original");
      assertEquals(second?.result.pageModule?.code, "export default {}");
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

    it("should destroy without error", async () => {
      const store = new MemoryCacheStore();
      await store.set("x", makePayload());
      await store.destroy();
    });
  });
});
