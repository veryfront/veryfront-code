import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert";
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

    it("owns an immutable snapshot of each entry", async () => {
      const entry = createEntry("original");
      await cache.set("key1", entry);
      entry.token = "mutated";

      const result = await cache.get("key1");
      assertEquals(result?.token, "original");
      assertEquals(Object.isFrozen(result), true);
      assertThrows(() => {
        result!.token = "caller-mutated";
      }, TypeError);
      assertEquals((await cache.get("key1"))?.token, "original");
    });

    it("does not invoke entry accessors", async () => {
      let reads = 0;
      const forged = Object.create(null);
      Object.defineProperty(forged, "token", {
        enumerable: true,
        get() {
          reads++;
          return "forged";
        },
      });

      await assertRejects(
        () => cache.set("key1", forged as TokenCacheEntry),
        TypeError,
        "invalid",
      );
      assertEquals(reads, 0);
    });

    it("treats an already expired write as a deletion", async () => {
      await cache.set("key", createEntry("current"));
      await cache.set("key", {
        token: "expired",
        expiresAt: Date.now() - 1,
        scope: "production",
      });

      assertEquals(await cache.has("key"), false);
      assertEquals((await cache.stats()).size, 0);
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

    it("does not evict another entry when replacing an existing key", async () => {
      const smallCache = new MemoryCache({ maxSize: 2, cleanupInterval: 0 });
      try {
        await smallCache.set("key1", createEntry("token-1"));
        await smallCache.set("key2", createEntry("token-2"));
        await smallCache.set("key2", createEntry("token-2-new"));

        assertEquals(await smallCache.has("key1"), true);
        assertEquals((await smallCache.get("key2"))?.token, "token-2-new");
      } finally {
        await smallCache.close();
      }
    });

    it("refreshes recency when an entry is read", async () => {
      const smallCache = new MemoryCache({ maxSize: 2, cleanupInterval: 0 });
      try {
        await smallCache.set("key1", createEntry("token-1"));
        await smallCache.set("key2", createEntry("token-2"));
        await smallCache.get("key1");
        await smallCache.set("key3", createEntry("token-3"));

        assertEquals(await smallCache.has("key1"), true);
        assertEquals(await smallCache.has("key2"), false);
      } finally {
        await smallCache.close();
      }
    });
  });

  it("validates construction policy", () => {
    assertThrows(
      () => new MemoryCache({ maxSize: 0 }),
      RangeError,
      "between 1 and 100000",
    );
    assertThrows(
      () => new MemoryCache({ cleanupInterval: Number.NaN }),
      RangeError,
      "cleanupInterval",
    );
    const accessorOptions = Object.defineProperty({}, "maxSize", {
      get: () => 10,
    });
    assertThrows(
      () => new MemoryCache(accessorOptions),
      TypeError,
      "data property",
    );
    assertThrows(
      () => new MemoryCache({ maxsize: 10 } as never),
      TypeError,
      "unknown option",
    );
  });

  it("is idempotently closed and rejects later operations", async () => {
    await cache.close();
    await cache.close();

    await assertRejects(() => cache.get("key"), Error, "closed");
    await assertRejects(
      () => cache.set("key", createEntry("token")),
      Error,
      "closed",
    );
    await assertRejects(() => cache.stats(), Error, "closed");
  });
});
