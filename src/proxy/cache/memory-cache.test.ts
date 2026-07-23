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

    it("does not evict another entry when replacing an existing key at capacity", async () => {
      const smallCache = new MemoryCache({ maxSize: 2, cleanupInterval: 60000 });

      try {
        await smallCache.set("key1", createEntry("token-1"));
        await smallCache.set("key2", createEntry("token-2"));
        await smallCache.set("key2", createEntry("replacement"));

        assertEquals((await smallCache.get("key1"))?.token, "token-1");
        assertEquals((await smallCache.get("key2"))?.token, "replacement");
      } finally {
        await smallCache.close();
      }
    });

    it("removes expired entries before evicting a live entry", async () => {
      const smallCache = new MemoryCache({ maxSize: 2, cleanupInterval: 60000 });

      try {
        await smallCache.set("expired", createEntry("expired", -1));
        await smallCache.set("live", createEntry("live"));
        await smallCache.set("new", createEntry("new"));

        assertEquals(await smallCache.has("expired"), false);
        assertEquals(await smallCache.has("live"), true);
        assertEquals(await smallCache.has("new"), true);
      } finally {
        await smallCache.close();
      }
    });
  });

  it("rejects cache options that defeat capacity or timer bounds", () => {
    for (const maxSize of [0, -1, 1.5, 100_001, Number.NaN, Number.POSITIVE_INFINITY]) {
      assertThrows(
        () => new MemoryCache({ maxSize }),
        RangeError,
        "maxSize",
      );
    }
    for (const cleanupInterval of [0, -1, 1.5, Number.NaN, 2_147_483_648]) {
      assertThrows(
        () => new MemoryCache({ cleanupInterval }),
        RangeError,
        "cleanupInterval",
      );
    }
  });

  it("owns stored entries instead of exposing caller-owned mutable state", async () => {
    const original = createEntry("original");
    await cache.set("key", original);
    (original as { token: string; expiresAt: number }).token = "changed-by-writer";
    (original as { token: string; expiresAt: number }).expiresAt = 0;

    const firstRead = await cache.get("key");
    assertEquals(firstRead?.token, "original");
    if (firstRead) {
      (firstRead as { token: string; expiresAt: number }).token = "changed-by-reader";
      (firstRead as { token: string; expiresAt: number }).expiresAt = 0;
    }

    assertEquals((await cache.get("key"))?.token, "original");
  });

  it("snapshots accessor-backed entries once before validating them", async () => {
    let tokenReads = 0;
    const accessorEntry = {
      get token() {
        tokenReads++;
        return tokenReads === 1 ? "stable-token" : "changed-token";
      },
      expiresAt: Date.now() + 60_000,
      scope: "production" as const,
    };

    await cache.set("key", accessorEntry);

    assertEquals(tokenReads, 1);
    assertEquals((await cache.get("key"))?.token, "stable-token");
  });

  it("rejects malformed entries and oversized keys", async () => {
    await assertRejects(
      () => cache.set("key", { ...createEntry("token"), expiresAt: Number.NaN }),
      TypeError,
      "expiresAt",
    );
    await assertRejects(
      () => cache.set("key", { ...createEntry(""), token: "" }),
      TypeError,
      "token",
    );
    await assertRejects(
      () => cache.set("x".repeat(1_025), createEntry("token")),
      RangeError,
      "key",
    );
  });

  it("rejects operations after close", async () => {
    await cache.close();
    await assertRejects(() => cache.get("key"), Error, "closed");
    await assertRejects(() => cache.set("key", createEntry("token")), Error, "closed");
  });
});
