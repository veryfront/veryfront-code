import { assertEquals } from "#veryfront/testing/assert";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd";
import { MemoryCache } from "./memory-cache.ts";
import type { TokenCacheEntry } from "./types.ts";

function createEntry(token: string, expiresInMs = 60000): TokenCacheEntry {
  return {
    token,
    expiresAt: Date.now() + expiresInMs,
    scope: "production",
  };
}

describe("MemoryCache", () => {
  let cache: MemoryCache;

  beforeEach(() => {
    cache = new MemoryCache({ maxSize: 10, cleanupInterval: 60000 });
  });

  afterEach(async () => {
    await cache.close();
  });

  describe("get/set", () => {
    it("stores and retrieves entries", async () => {
      await cache.set("key1", createEntry("token-1"));

      const result = await cache.get("key1");
      assertEquals(result?.token, "token-1");
    });

    it("returns null for missing keys", async () => {
      assertEquals(await cache.get("nonexistent"), null);
    });

    it("returns null for expired entries", async () => {
      await cache.set("expired-key", createEntry("expired", -1000));

      assertEquals(await cache.get("expired-key"), null);
    });
  });

  describe("delete", () => {
    it("removes entries", async () => {
      await cache.set("key1", createEntry("token-1"));
      await cache.delete("key1");

      assertEquals(await cache.get("key1"), null);
    });
  });

  describe("has", () => {
    it("returns true for existing entries", async () => {
      await cache.set("key1", createEntry("token-1"));
      assertEquals(await cache.has("key1"), true);
    });

    it("returns false for missing entries", async () => {
      assertEquals(await cache.has("nonexistent"), false);
    });

    it("returns false for expired entries", async () => {
      await cache.set("expired", createEntry("token", -1000));
      assertEquals(await cache.has("expired"), false);
    });
  });

  describe("clear", () => {
    it("removes all entries", async () => {
      await cache.set("key1", createEntry("token-1"));
      await cache.set("key2", createEntry("token-2"));
      await cache.clear();

      assertEquals(await cache.has("key1"), false);
      assertEquals(await cache.has("key2"), false);
    });

    it("resets stats", async () => {
      await cache.get("miss1");
      await cache.get("miss2");
      await cache.clear();

      const stats = await cache.stats();
      assertEquals(stats.hits, 0);
      assertEquals(stats.misses, 0);
    });
  });

  describe("stats", () => {
    it("tracks hits and misses", async () => {
      await cache.set("key1", createEntry("token-1"));

      await cache.get("key1");
      await cache.get("key1");
      await cache.get("missing");

      const stats = await cache.stats();
      assertEquals(stats.hits, 2);
      assertEquals(stats.misses, 1);
      assertEquals(stats.size, 1);
      assertEquals(stats.type, "memory");
    });
  });

  describe("maxSize", () => {
    it("evicts oldest entry when full", async () => {
      const smallCache = new MemoryCache({ maxSize: 2, cleanupInterval: 60000 });

      try {
        await smallCache.set("key1", createEntry("token-1"));
        await smallCache.set("key2", createEntry("token-2"));
        await smallCache.set("key3", createEntry("token-3"));

        assertEquals(await smallCache.has("key1"), false);
        assertEquals(await smallCache.has("key2"), true);
        assertEquals(await smallCache.has("key3"), true);
      } finally {
        await smallCache.close();
      }
    });
  });
});
