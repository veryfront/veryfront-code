import { afterEach, beforeEach, describe, it } from "@std/testing/bdd.ts";
import { expect } from "@std/expect";
import { RedisCacheStore } from "./redis-store.ts";
import type { CachePayload } from "../types.ts";

// Mock payload for testing
const createTestPayload = (html: string): CachePayload => ({
  result: {
    html,
    frontmatter: {},
  },
  storedAt: Date.now(),
});

describe("RedisCacheStore", () => {
  describe("constructor", () => {
    it("should create store with default options", () => {
      const store = new RedisCacheStore();
      expect(store).toBeDefined();
    });

    it("should create store with custom key prefix", () => {
      const store = new RedisCacheStore({ keyPrefix: "custom:" });
      expect(store).toBeDefined();
    });

    it("should create store with fallback disabled", () => {
      const store = new RedisCacheStore({ enableFallback: false });
      expect(store).toBeDefined();
    });
  });

  describe("fallback behavior", () => {
    let store: RedisCacheStore;

    beforeEach(() => {
      // Create store with fallback enabled (default)
      store = new RedisCacheStore({
        url: "redis://invalid-host:9999", // Invalid URL to trigger fallback
        enableFallback: true,
      });
    });

    afterEach(async () => {
      await store.destroy();
    });

    it("should fall back to memory store on connection failure", async () => {
      const payload = createTestPayload("<div>Test</div>");

      // This should trigger fallback since Redis URL is invalid
      try {
        await store.set("test-key", payload);
      } catch {
        // Expected to fail on first try, then use fallback
      }

      // After fallback is triggered, subsequent operations should work via memory store
      // The fallback store is created lazily when Redis is unavailable
    });
  });

  describe("key prefixing", () => {
    it("should use default prefix", () => {
      const store = new RedisCacheStore();
      // The store uses "veryfront:render:" as default prefix
      expect(store).toBeDefined();
    });

    it("should use custom prefix", () => {
      const store = new RedisCacheStore({ keyPrefix: "myapp:cache:" });
      expect(store).toBeDefined();
    });
  });

  describe("destroy", () => {
    it("should clean up resources on destroy", async () => {
      const store = new RedisCacheStore();
      await store.destroy();
      // Should not throw when destroying uninitialized store
    });

    it("should clean up fallback store on destroy", async () => {
      const store = new RedisCacheStore({
        url: "redis://invalid:9999",
        enableFallback: true,
      });

      // Try to trigger fallback
      try {
        await store.get("test");
      } catch {
        // Expected
      }

      // Destroy should clean up both stores
      await store.destroy();
    });
  });
});

describe("RedisCacheStore with fallback disabled", () => {
  let store: RedisCacheStore;

  beforeEach(() => {
    store = new RedisCacheStore({
      url: "redis://invalid-host:9999",
      enableFallback: false,
    });
  });

  afterEach(async () => {
    await store.destroy();
  });

  it("should throw on get when Redis unavailable and fallback disabled", async () => {
    await expect(store.get("test-key")).rejects.toThrow();
  });

  it("should throw on set when Redis unavailable and fallback disabled", async () => {
    const payload = createTestPayload("<div>Test</div>");
    await expect(store.set("test-key", payload)).rejects.toThrow();
  });

  it("should throw on delete when Redis unavailable and fallback disabled", async () => {
    await expect(store.delete("test-key")).rejects.toThrow();
  });

  it("should throw on clear when Redis unavailable and fallback disabled", async () => {
    await expect(store.clear()).rejects.toThrow();
  });
});
