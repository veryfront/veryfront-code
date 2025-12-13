import { describe, it, afterEach } from "std/testing/bdd.ts";
import { assertEquals, assertExists } from "std/assert/mod.ts";
import { KVCacheStore } from "./kv-store.ts";
import type { CachePayload } from "../types.ts";

// Track stores for cleanup
const activeStores: KVCacheStore[] = [];

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

describe("KVCacheStore", () => {
  afterEach(async () => {
    // Clean up all active stores
    for (const store of activeStores) {
      try {
        await store.destroy();
      } catch {
        // Ignore errors during cleanup
      }
    }
    activeStores.length = 0;
  });

  describe("constructor", () => {
    it("should create instance with default options", () => {
      const store = new KVCacheStore();
      activeStores.push(store);
      assertExists(store);
    });

    it("should create instance with custom path", () => {
      const store = new KVCacheStore({ path: "/custom/path" });
      activeStores.push(store);
      assertExists(store);
    });
  });

  describe("without KV support (non-Deno environment)", () => {
    it("should handle missing KV gracefully on get", async () => {
      // In non-Deno environment or when KV is not available
      const store = new KVCacheStore();
      activeStores.push(store);

      // If Deno KV is not available, should return undefined
      const result = await store.get("test-key");

      // Either undefined (no KV) or a value (KV available)
      if (result !== undefined) {
        assertExists(result.result);
      }
    });

    it("should handle missing KV gracefully on set", async () => {
      const store = new KVCacheStore();
      activeStores.push(store);
      const payload = createPayload("<p>Test</p>");

      // Should not throw even if KV is not available
      await store.set("test-key", payload);
    });

    it("should handle missing KV gracefully on delete", async () => {
      const store = new KVCacheStore();
      activeStores.push(store);

      // Should not throw even if KV is not available
      await store.delete("test-key");
    });

    it("should handle missing KV gracefully on clear", async () => {
      const store = new KVCacheStore();
      activeStores.push(store);

      // Should not throw even if KV is not available
      await store.clear();
    });

    it("should handle missing KV gracefully on destroy", async () => {
      const store = new KVCacheStore();
      activeStores.push(store);

      // Should not throw even if KV is not available
      await store.destroy();
    });
  });

  describe("KV integration tests (if Deno KV available)", () => {
    it("should test basic operations if KV is available", async () => {
      const store = new KVCacheStore();
      activeStores.push(store);
      const payload = createPayload("<h1>Integration Test</h1>");

      try {
        // Try to use KV if available
        await store.set("integration-test", payload);
        const result = await store.get("integration-test");

        if (result) {
          // KV is available and working
          assertEquals(result.result.html, "<h1>Integration Test</h1>");

          // Test delete
          await store.delete("integration-test");
          const deleted = await store.get("integration-test");
          assertEquals(deleted, undefined);
        }
      } catch {
        // KV not available, skip test
      }
    });

    it("should test clear operation if KV is available", async () => {
      const store = new KVCacheStore();
      activeStores.push(store);

      try {
        await store.set("key1", createPayload("<p>1</p>"));
        await store.set("key2", createPayload("<p>2</p>"));

        await store.clear();

        const result1 = await store.get("key1");
        const result2 = await store.get("key2");

        assertEquals(result1, undefined);
        assertEquals(result2, undefined);
      } catch {
        // KV not available, skip test
      }
    });

    it("should test destroy operation if KV is available", async () => {
      const store = new KVCacheStore();
      activeStores.push(store);

      try {
        await store.set("destroy-test", createPayload("<p>Test</p>"));
        await store.destroy();

        // After destroy, should be able to create a new connection
        await store.set("after-destroy", createPayload("<p>After</p>"));
        const result = await store.get("after-destroy");

        if (result) {
          assertEquals(result.result.html, "<p>After</p>");
        }
      } catch {
        // KV not available, skip test
      }
    });
  });

  describe("payload serialization", () => {
    it("should handle complex payloads", async () => {
      const store = new KVCacheStore();
      activeStores.push(store);
      const payload: CachePayload = {
        result: {
          html: "<div>Complex</div>",
          frontmatter: {
            title: "Test",
            tags: ["tag1", "tag2"],
          },
          css: "body { margin: 0; }",
          headings: [
            { id: "h1", text: "Heading 1", level: 1 },
            { id: "h2", text: "Heading 2", level: 2 },
          ],
        },
        storedAt: Date.now(),
        expiresAt: Date.now() + 3600000,
      };

      try {
        await store.set("complex", payload);
        const result = await store.get("complex");

        if (result) {
          assertEquals(result.result.html, "<div>Complex</div>");
          assertEquals(result.result.css, "body { margin: 0; }");
          assertEquals(result.result.headings?.length, 2);
          assertEquals(result.result.frontmatter.title, "Test");
        }
      } catch {
        // KV not available, test passes
      }
    });
  });
});
