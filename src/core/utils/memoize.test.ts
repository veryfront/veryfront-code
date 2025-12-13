import { describe, it } from "std/testing/bdd.ts";
import { assertEquals, assert } from "std/assert/mod.ts";
import {
  MemoCache,
  memoize,
  memoizeAsync,
  simpleHash,
} from "./memoize.ts";

describe("utils/memoize", () => {
  describe("MemoCache", () => {
    it("should create an empty cache", () => {
      const cache = new MemoCache<string>();
      assertEquals(cache.size(), 0);
    });

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
      const cache = new MemoCache<boolean>();
      assertEquals(cache.has("key1"), false);
      cache.set("key1", true);
      assertEquals(cache.has("key1"), true);
    });

    it("should clear all entries", () => {
      const cache = new MemoCache<number>();
      cache.set("key1", 1);
      cache.set("key2", 2);
      assertEquals(cache.size(), 2);
      cache.clear();
      assertEquals(cache.size(), 0);
      assertEquals(cache.has("key1"), false);
    });

    it("should track size correctly", () => {
      const cache = new MemoCache<string>();
      assertEquals(cache.size(), 0);
      cache.set("a", "1");
      assertEquals(cache.size(), 1);
      cache.set("b", "2");
      assertEquals(cache.size(), 2);
      cache.set("a", "3"); // Overwrite
      assertEquals(cache.size(), 2);
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

    it("should cache different arguments separately", () => {
      let callCount = 0;
      const fn = (x: number) => {
        callCount++;
        return x * 2;
      };
      const memoized = memoize(fn, (x) => String(x));

      assertEquals(memoized(5), 10);
      assertEquals(memoized(10), 20);
      assertEquals(callCount, 2);
      assertEquals(memoized(5), 10);
      assertEquals(callCount, 2); // Cached
    });

    it("should work with multiple arguments", () => {
      const fn = (a: number, b: number) => a + b;
      const memoized = memoize(fn, (a, b) => `${a}-${b}`);

      assertEquals(memoized(2, 3), 5);
      assertEquals(memoized(2, 3), 5);
      assertEquals(memoized(3, 2), 5);
    });

    it("should work with string arguments", () => {
      const fn = (str: string) => str.toUpperCase();
      const memoized = memoize(fn, (s) => s);

      assertEquals(memoized("hello"), "HELLO");
      assertEquals(memoized("hello"), "HELLO");
    });
  });

  describe("memoizeAsync", () => {
    it("should cache async function results", async () => {
      let callCount = 0;
      const fn = async (x: number) => {
        callCount++;
        return x * 2;
      };
      const memoized = memoizeAsync(fn, (x) => String(x));

      assertEquals(await memoized(5), 10);
      assertEquals(callCount, 1);
      assertEquals(await memoized(5), 10);
      assertEquals(callCount, 1); // Not called again
    });

    it("should cache different arguments separately", async () => {
      let callCount = 0;
      const fn = async (x: number) => {
        callCount++;
        return x * 2;
      };
      const memoized = memoizeAsync(fn, (x) => String(x));

      assertEquals(await memoized(5), 10);
      assertEquals(await memoized(10), 20);
      assertEquals(callCount, 2);
      assertEquals(await memoized(5), 10);
      assertEquals(callCount, 2); // Cached
    });

    it("should work with delayed async functions", async () => {
      let callCount = 0;
      const fn = async (x: number) => {
        callCount++;
        await new Promise((resolve) => setTimeout(resolve, 10));
        return x * 3;
      };
      const memoized = memoizeAsync(fn, (x) => String(x));

      assertEquals(await memoized(4), 12);
      assertEquals(callCount, 1);
      assertEquals(await memoized(4), 12);
      assertEquals(callCount, 1); // Should use cache, not wait
    });
  });

  describe("simpleHash", () => {
    it("should generate hash for single value", () => {
      const hash = simpleHash("test");
      assert(typeof hash === "string");
      assert(hash.length > 0);
    });

    it("should generate consistent hashes", () => {
      const hash1 = simpleHash("test");
      const hash2 = simpleHash("test");
      assertEquals(hash1, hash2);
    });

    it("should generate different hashes for different values", () => {
      const hash1 = simpleHash("test1");
      const hash2 = simpleHash("test2");
      assert(hash1 !== hash2);
    });

    it("should work with multiple arguments", () => {
      const hash1 = simpleHash("a", "b", "c");
      const hash2 = simpleHash("a", "b", "c");
      assertEquals(hash1, hash2);

      const hash3 = simpleHash("a", "b", "d");
      assert(hash1 !== hash3);
    });

    it("should work with numbers", () => {
      const hash = simpleHash(123);
      assert(typeof hash === "string");
    });

    it("should work with mixed types", () => {
      const hash = simpleHash("test", 123, true);
      assert(typeof hash === "string");
      assert(hash.length > 0);
    });

    it("should handle empty arguments", () => {
      const hash = simpleHash();
      assert(typeof hash === "string");
    });

    it("should be order-sensitive", () => {
      const hash1 = simpleHash("a", "b");
      const hash2 = simpleHash("b", "a");
      assert(hash1 !== hash2);
    });
  });
});
