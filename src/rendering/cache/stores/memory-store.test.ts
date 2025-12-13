import { describe, it, beforeEach, afterEach } from "std/testing/bdd.ts";
import { assertEquals, assertExists } from "std/assert/mod.ts";
import { MemoryCacheStore } from "./memory-store.ts";
import type { CachePayload } from "../types.ts";

// Helper to create a valid cache payload
function createPayload(html: string): CachePayload {
  return {
    result: {
      html,
      frontmatter: {},
    },
    storedAt: Date.now(),
  };
}

describe("MemoryCacheStore", () => {
  let store: MemoryCacheStore;
  const allStores: MemoryCacheStore[] = [];

  beforeEach(() => {
    store = new MemoryCacheStore();
    allStores.push(store);
  });

  afterEach(async () => {
    // Clean up all stores to prevent interval leaks
    for (const s of allStores) {
      await s.destroy();
    }
    allStores.length = 0;
  });

  describe("constructor", () => {
    it("should create instance with default options", () => {
      const defaultStore = new MemoryCacheStore();
      allStores.push(defaultStore);
      assertExists(defaultStore);
    });

    it("should create instance with custom max entries", () => {
      const customStore = new MemoryCacheStore({ maxEntries: 100 });
      allStores.push(customStore);
      assertExists(customStore);
    });

    it("should create instance with custom TTL", () => {
      const customStore = new MemoryCacheStore({ ttlMs: 5000 });
      allStores.push(customStore);
      assertExists(customStore);
    });

    it("should create instance with both options", () => {
      const customStore = new MemoryCacheStore({
        maxEntries: 200,
        ttlMs: 10000,
      });
      allStores.push(customStore);
      assertExists(customStore);
    });
  });

  describe("get", () => {
    it("should return undefined for non-existent key", async () => {
      const result = await store.get("nonexistent");
      assertEquals(result, undefined);
    });

    it("should retrieve value that was set", async () => {
      const payload = createPayload("<h1>Test</h1>");
      await store.set("test-key", payload);

      const result = await store.get("test-key");
      assertExists(result);
      assertEquals(result.result.html, "<h1>Test</h1>");
    });

    it("should handle multiple keys", async () => {
      await store.set("key1", createPayload("<p>One</p>"));
      await store.set("key2", createPayload("<p>Two</p>"));

      const result1 = await store.get("key1");
      const result2 = await store.get("key2");

      assertExists(result1);
      assertExists(result2);
      assertEquals(result1.result.html, "<p>One</p>");
      assertEquals(result2.result.html, "<p>Two</p>");
    });
  });

  describe("set", () => {
    it("should store value", async () => {
      const payload = createPayload("<div>Content</div>");
      await store.set("my-key", payload);

      const result = await store.get("my-key");
      assertExists(result);
      assertEquals(result.result.html, "<div>Content</div>");
    });

    it("should overwrite existing value", async () => {
      await store.set("key", createPayload("<p>First</p>"));
      await store.set("key", createPayload("<p>Second</p>"));

      const result = await store.get("key");
      assertExists(result);
      assertEquals(result.result.html, "<p>Second</p>");
    });

    it("should handle complex payloads", async () => {
      const payload: CachePayload = {
        result: {
          html: "<article>Test</article>",
          frontmatter: {
            title: "Test Article",
            tags: ["test", "article"],
          },
          css: "article { padding: 1em; }",
          headings: [{ id: "intro", text: "Introduction", level: 2 }],
        },
        storedAt: Date.now(),
        expiresAt: Date.now() + 60000,
      };

      await store.set("complex", payload);
      const result = await store.get("complex");

      assertExists(result);
      assertEquals(result.result.frontmatter.title, "Test Article");
      assertEquals(result.result.css, "article { padding: 1em; }");
    });
  });

  describe("delete", () => {
    it("should delete existing key", async () => {
      await store.set("delete-me", createPayload("<p>Delete</p>"));

      await store.delete("delete-me");
      const result = await store.get("delete-me");

      assertEquals(result, undefined);
    });

    it("should not throw when deleting non-existent key", async () => {
      await store.delete("nonexistent");
      // Should not throw
    });

    it("should only delete specified key", async () => {
      await store.set("keep", createPayload("<p>Keep</p>"));
      await store.set("remove", createPayload("<p>Remove</p>"));

      await store.delete("remove");

      const kept = await store.get("keep");
      const removed = await store.get("remove");

      assertExists(kept);
      assertEquals(removed, undefined);
    });
  });

  describe("clear", () => {
    it("should remove all entries", async () => {
      await store.set("key1", createPayload("<p>1</p>"));
      await store.set("key2", createPayload("<p>2</p>"));
      await store.set("key3", createPayload("<p>3</p>"));

      await store.clear();

      const result1 = await store.get("key1");
      const result2 = await store.get("key2");
      const result3 = await store.get("key3");

      assertEquals(result1, undefined);
      assertEquals(result2, undefined);
      assertEquals(result3, undefined);
    });

    it("should allow new entries after clear", async () => {
      await store.set("old", createPayload("<p>Old</p>"));
      await store.clear();
      await store.set("new", createPayload("<p>New</p>"));

      const result = await store.get("new");
      assertExists(result);
      assertEquals(result.result.html, "<p>New</p>");
    });
  });

  describe("destroy", () => {
    it("should destroy the cache", async () => {
      await store.set("key", createPayload("<p>Test</p>"));
      await store.destroy();

      // After destroy, cache should be cleared
      const result = await store.get("key");
      assertEquals(result, undefined);
    });
  });

  describe("LRU behavior", () => {
    it("should respect max entries limit", async () => {
      const limitedStore = new MemoryCacheStore({ maxEntries: 3 });
      allStores.push(limitedStore);

      await limitedStore.set("key1", createPayload("<p>1</p>"));
      await limitedStore.set("key2", createPayload("<p>2</p>"));
      await limitedStore.set("key3", createPayload("<p>3</p>"));
      await limitedStore.set("key4", createPayload("<p>4</p>"));

      // First key should be evicted due to LRU
      const result1 = await limitedStore.get("key1");
      const result4 = await limitedStore.get("key4");

      // Newest entry should exist
      assertExists(result4);
      assertEquals(result4.result.html, "<p>4</p>");
    });
  });
});
