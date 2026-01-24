import { assertEquals, assertNotEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { delay } from "#std/async.ts";
import { MemoCache, memoize, memoizeAsync, simpleHash } from "./memoize.ts";

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
    function createDoublerMemoized(callCount: { value: number }) {
      const fn = (x: number) => {
        callCount.value++;
        return x * 2;
      };
      return memoize(fn, (x) => String(x));
    }

    it("should cache function results", () => {
      const callCount = { value: 0 };
      const memoized = createDoublerMemoized(callCount);

      assertEquals(memoized(5), 10);
      assertEquals(callCount.value, 1);
      assertEquals(memoized(5), 10);
      assertEquals(callCount.value, 1);
    });

    it("should call function for different arguments", () => {
      const callCount = { value: 0 };
      const memoized = createDoublerMemoized(callCount);

      memoized(5);
      memoized(10);
      assertEquals(callCount.value, 2);
    });

    it("should use key hasher for cache key", () => {
      const fn = (a: number, b: number) => a + b;
      const memoized = memoize(fn, (a, b) => `${a}-${b}`);

      assertEquals(memoized(1, 2), 3);
      assertEquals(memoized(2, 1), 3);
    });

    it("should handle complex return types", () => {
      const fn = (id: string) => ({ id, timestamp: Date.now() });
      const memoized = memoize(fn, (id) => id);

      const result1 = memoized("test");
      const result2 = memoized("test");
      assertEquals(result1, result2);
    });
  });

  describe("memoizeAsync", () => {
    function createAsyncDoublerMemoized(callCount: { value: number }) {
      const fn = async (x: number) => {
        await Promise.resolve();
        callCount.value++;
        return x * 2;
      };
      return memoizeAsync(fn, (x) => String(x));
    }

    it("should cache async function results", async () => {
      const callCount = { value: 0 };
      const memoized = createAsyncDoublerMemoized(callCount);

      assertEquals(await memoized(5), 10);
      assertEquals(callCount.value, 1);
      assertEquals(await memoized(5), 10);
      assertEquals(callCount.value, 1);
    });

    it("should call async function for different arguments", async () => {
      const callCount = { value: 0 };
      const memoized = createAsyncDoublerMemoized(callCount);

      await memoized(5);
      await memoized(10);
      assertEquals(callCount.value, 2);
    });

    it("should handle promise resolution", async () => {
      const fn = async (msg: string) => {
        await delay(1);
        return `processed: ${msg}`;
      };
      const memoized = memoizeAsync(fn, (msg) => msg);

      assertEquals(await memoized("hello"), "processed: hello");
    });
  });

  describe("simpleHash", () => {
    it("should produce a string hash", () => {
      assertEquals(typeof simpleHash("test"), "string");
    });

    it("should produce consistent hashes", () => {
      assertEquals(simpleHash("consistent"), simpleHash("consistent"));
    });

    it("should produce different hashes for different values", () => {
      assertNotEquals(simpleHash("value1"), simpleHash("value2"));
    });

    it("should handle multiple arguments", () => {
      assertEquals(simpleHash("a", "b", "c"), simpleHash("a", "b", "c"));
    });

    it("should produce different hashes for different argument combinations", () => {
      assertNotEquals(simpleHash("a", "b"), simpleHash("b", "a"));
    });

    it("should handle non-string values", () => {
      assertEquals(simpleHash(123, true, null), simpleHash(123, true, null));
    });

    it("should handle empty string", () => {
      assertEquals(typeof simpleHash(""), "string");
    });

    it("should handle no arguments", () => {
      assertEquals(typeof simpleHash(), "string");
    });
  });
});
