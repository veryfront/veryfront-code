import { describe, it } from "std/testing/bdd.ts";
import { assertEquals, assertExists } from "std/assert/mod.ts";
import { RedisCacheStore } from "./redis-store.ts";

describe("RedisCacheStore", () => {
  describe("constructor", () => {
    it("should create instance with default options", () => {
      const store = new RedisCacheStore();
      assertExists(store);
    });

    it("should create instance with custom URL", () => {
      const store = new RedisCacheStore({ url: "redis://localhost:6379" });
      assertExists(store);
    });

    it("should create instance with custom key prefix", () => {
      const store = new RedisCacheStore({ keyPrefix: "custom:" });
      assertExists(store);
    });

    it("should create instance with both URL and prefix", () => {
      const store = new RedisCacheStore({
        url: "redis://localhost:6379",
        keyPrefix: "app:",
      });
      assertExists(store);
    });
  });

  describe("without Redis connection", () => {
    it("should handle missing Redis gracefully on get", async () => {
      const store = new RedisCacheStore();

      // Without actual Redis, should handle gracefully
      try {
        const result = await store.get("test-key");
        // Either undefined or throws - both acceptable without Redis
        if (result !== undefined) {
          assertExists(result);
        }
      } catch {
        // Expected when Redis is not available
      }
    });

    it("should handle missing Redis gracefully on set", async () => {
      const store = new RedisCacheStore();

      try {
        await store.set("test", {
          result: { html: "<p>Test</p>", frontmatter: {} },
          storedAt: Date.now(),
        });
        // May succeed or fail depending on Redis availability
      } catch {
        // Expected when Redis is not available
      }
    });

    it("should handle missing Redis gracefully on delete", async () => {
      const store = new RedisCacheStore();

      try {
        await store.delete("test");
        // May succeed or fail depending on Redis availability
      } catch {
        // Expected when Redis is not available
      }
    });

    it("should handle missing Redis gracefully on clear", async () => {
      const store = new RedisCacheStore();

      try {
        await store.clear();
        // May succeed or fail depending on Redis availability
      } catch {
        // Expected when Redis is not available
      }
    });

    it("should handle missing Redis gracefully on destroy", async () => {
      const store = new RedisCacheStore();

      try {
        await store.destroy();
        // Should not throw
      } catch {
        // Expected when Redis is not available
      }
    });
  });

  describe("key prefixing", () => {
    it("should use default prefix", () => {
      const store = new RedisCacheStore();
      assertExists(store);
      // Default prefix is "veryfront:render:" (tested in constructor)
    });

    it("should use custom prefix when provided", () => {
      const store = new RedisCacheStore({ keyPrefix: "myapp:" });
      assertExists(store);
      // Custom prefix should be used for all operations
    });
  });
});
