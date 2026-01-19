import { assertEquals, assertNotEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { MemoCache, memoize, memoizeAsync, simpleHash } from "./memoize.ts";
import { delay } from "#std/async.ts";

describe("memoize", () => {
  describe("MemoCache", () => {
    it("should set and get values", () => {
      const cache = new MemoCache<number>();
      cache.set("key1", 42);
      assertEquals(cache.get("key1"), 42);
    });

    it("should return undefined for missing keys", () => {
      const cache = new MemoCache<string>();
      assertEquals(cache.get("missing"), undefined);
    });

    it("should check if key exists", () => {
      const cache = new MemoCache<string>();
      cache.set("exists", "value");
      assertEquals(cache.has("exists"), true);
      assertEquals(cache.has("missing"), false);
    });

    it("should clear all entries", () => {
      const cache = new MemoCache<number>();
      cache.set("a", 1);
      cache.set("b", 2);
      assertEquals(cache.size(), 2);
      cache.clear();
      assertEquals(cache.size(), 0);
      assertEquals(cache.has("a"), false);
    });

    it("should return correct size", () => {
      const cache = new MemoCache<string>();
      assertEquals(cache.size(), 0);
      cache.set("a", "1");
      assertEquals(cache.size(), 1);
      cache.set("b", "2");
      assertEquals(cache.size(), 2);
    });

    it("should overwrite existing values", () => {
      const cache = new MemoCache<number>();
      cache.set("key", 1);
      cache.set("key", 2);
      assertEquals(cache.get("key"), 2);
      assertEquals(cache.size(), 1);
    });
  });

  describe("memoize", () => {
    it("should cache function results", () => {
      let callCount = 0;
      const fn = (x: number) => {
        callCount++;
        return x * 2;
      };
      const memoized = memoize(fn, (x) => String(x));

      assertEquals(memoized(5), 10);
      assertEquals(callCount, 1);
      assertEquals(memoized(5), 10);
      assertEquals(callCount, 1); // Not called again
    });

    it("should call function for different arguments", () => {
      let callCount = 0;
      const fn = (x: number) => {
        callCount++;
        return x * 2;
      };
      const memoized = memoize(fn, (x) => String(x));

      memoized(5);
      memoized(10);
      assertEquals(callCount, 2);
    });

    it("should use key hasher for cache key", () => {
      const fn = (a: number, b: number) => a + b;
      const memoized = memoize(fn, (a, b) => `${a}-${b}`);

      assertEquals(memoized(1, 2), 3);
      assertEquals(memoized(2, 1), 3); // Different key
    });

    it("should handle complex return types", () => {
      const fn = (id: string) => ({ id, timestamp: Date.now() });
      const memoized = memoize(fn, (id) => id);

      const result1 = memoized("test");
      const result2 = memoized("test");
      assertEquals(result1, result2); // Same object reference
    });
  });

  describe("memoizeAsync", () => {
    it("should cache async function results", async () => {
      let callCount = 0;
      const fn = async (x: number) => {
        await Promise.resolve();
        callCount++;
        return x * 2;
      };
      const memoized = memoizeAsync(fn, (x) => String(x));

      assertEquals(await memoized(5), 10);
      assertEquals(callCount, 1);
      assertEquals(await memoized(5), 10);
      assertEquals(callCount, 1); // Not called again
    });

    it("should call async function for different arguments", async () => {
      let callCount = 0;
      const fn = async (x: number) => {
        await Promise.resolve();
        callCount++;
        return x * 2;
      };
      const memoized = memoizeAsync(fn, (x) => String(x));

      await memoized(5);
      await memoized(10);
      assertEquals(callCount, 2);
    });

    it("should handle promise resolution", async () => {
      const fn = async (msg: string) => {
        await delay(1);
        return `processed: ${msg}`;
      };
      const memoized = memoizeAsync(fn, (msg) => msg);

      const result = await memoized("hello");
      assertEquals(result, "processed: hello");
    });
  });

  describe("simpleHash", () => {
    it("should produce a string hash", () => {
      const hash = simpleHash("test");
      assertEquals(typeof hash, "string");
    });

    it("should produce consistent hashes", () => {
      const hash1 = simpleHash("consistent");
      const hash2 = simpleHash("consistent");
      assertEquals(hash1, hash2);
    });

    it("should produce different hashes for different values", () => {
      const hash1 = simpleHash("value1");
      const hash2 = simpleHash("value2");
      assertNotEquals(hash1, hash2);
    });

    it("should handle multiple arguments", () => {
      const hash1 = simpleHash("a", "b", "c");
      const hash2 = simpleHash("a", "b", "c");
      assertEquals(hash1, hash2);
    });

    it("should produce different hashes for different argument combinations", () => {
      const hash1 = simpleHash("a", "b");
      const hash2 = simpleHash("b", "a");
      assertNotEquals(hash1, hash2);
    });

    it("should handle non-string values", () => {
      const hash1 = simpleHash(123, true, null);
      const hash2 = simpleHash(123, true, null);
      assertEquals(hash1, hash2);
    });

    it("should handle empty string", () => {
      const hash = simpleHash("");
      assertEquals(typeof hash, "string");
    });

    it("should handle no arguments", () => {
      const hash = simpleHash();
      assertEquals(typeof hash, "string");
    });
  });
});
