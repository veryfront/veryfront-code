import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertNotEquals,
  assertRejects,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { delay } from "#std/async.ts";
import {
  DEFAULT_MEMO_CACHE_MAX_ENTRIES,
  MAX_MEMO_CACHE_ENTRIES,
  MAX_MEMO_KEY_CHARACTERS,
  MAX_MEMOIZE_INFLIGHT,
  MemoCache,
  memoize,
  memoizeAsync,
  simpleHash,
} from "./memoize.ts";

describe("memoize", () => {
  describe("MemoCache", () => {
    it("stores, replaces, and clears entries", () => {
      const cache = new MemoCache<number>();

      cache.set("key", 1);
      assertEquals(cache.get("key"), 1);
      assertEquals(cache.has("key"), true);
      assertEquals(cache.size(), 1);

      cache.set("key", 2);
      assertEquals(cache.get("key"), 2);
      assertEquals(cache.size(), 1);

      cache.clear();
      assertEquals(cache.has("key"), false);
      assertEquals(cache.size(), 0);
    });

    it("uses a finite default and evicts by least-recently-used order", () => {
      const cache = new MemoCache<number>();
      for (let index = 0; index < DEFAULT_MEMO_CACHE_MAX_ENTRIES; index++) {
        cache.set(`key-${index}`, index);
      }

      assertEquals(cache.get("key-0"), 0);
      cache.set("new-key", 999);

      assertEquals(cache.size(), DEFAULT_MEMO_CACHE_MAX_ENTRIES);
      assertEquals(cache.has("key-0"), true);
      assertEquals(cache.has("key-1"), false);
      assertEquals(cache.get("new-key"), 999);
    });

    it("validates explicit entry budgets", () => {
      for (
        const maxEntries of [
          0,
          -1,
          1.5,
          Number.NaN,
          Number.POSITIVE_INFINITY,
          MAX_MEMO_CACHE_ENTRIES + 1,
        ]
      ) {
        assertThrows(
          () => new MemoCache({ maxEntries }),
          RangeError,
          "maxEntries",
        );
      }
    });
  });

  describe("memoize", () => {
    function createDoublerMemoized(callCount: { value: number }): (x: number) => number {
      const fn = (x: number): number => {
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
      const fn = (a: number, b: number): number => a + b;
      const memoized = memoize(fn, (a, b) => `${a}-${b}`);

      assertEquals(memoized(1, 2), 3);
      assertEquals(memoized(2, 1), 3);
    });

    it("should handle complex return types", () => {
      const fn = (id: string): { id: string; timestamp: number } => ({ id, timestamp: Date.now() });
      const memoized = memoize(fn, (id) => id);

      const result1 = memoized("test");
      const result2 = memoized("test");
      assertEquals(result1, result2);
    });

    it("honors an explicit LRU result budget", () => {
      let calls = 0;
      const memoized = memoize(
        (key: string) => {
          calls++;
          return key.toUpperCase();
        },
        (key) => key,
        { maxEntries: 1 },
      );

      assertEquals(memoized("a"), "A");
      assertEquals(memoized("b"), "B");
      assertEquals(memoized("a"), "A");
      assertEquals(calls, 3);
    });

    it("rejects cache keys that exceed the retained-key budget", () => {
      const memoized = memoize(
        (key: string) => key,
        (key) => key,
      );

      assertThrows(
        () => memoized("k".repeat(MAX_MEMO_KEY_CHARACTERS + 1)),
        RangeError,
        "key",
      );
    });
  });

  describe("memoizeAsync", () => {
    function createAsyncDoublerMemoized(
      callCount: { value: number },
    ): (x: number) => Promise<number> {
      const fn = async (x: number): Promise<number> => {
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

      const cached = memoized(5);
      assertEquals(cached instanceof Promise, true);
      assertEquals(await cached, 10);
      assertEquals(callCount.value, 1);
    });

    it("does not cache rejected cross-realm-compatible thenables", async () => {
      let callCount = 0;
      const memoized = memoizeAsync(
        () => {
          callCount++;
          return {
            then(
              _resolve: (value: number) => void,
              reject: (reason: unknown) => void,
            ) {
              reject(new Error("thenable failed"));
            },
          } as Promise<number>;
        },
        () => "shared",
      );

      await assertRejects(() => memoized(), Error, "thenable failed");
      await assertRejects(() => memoized(), Error, "thenable failed");
      assertEquals(callCount, 2);
    });

    it("should call async function for different arguments", async () => {
      const callCount = { value: 0 };
      const memoized = createAsyncDoublerMemoized(callCount);

      await memoized(5);
      await memoized(10);
      assertEquals(callCount.value, 2);
    });

    it("should handle promise resolution", async () => {
      const fn = async (msg: string): Promise<string> => {
        await delay(1);
        return `processed: ${msg}`;
      };
      const memoized = memoizeAsync(fn, (msg) => msg);

      assertEquals(await memoized("hello"), "processed: hello");
    });

    it("bounds distinct in-flight keys while preserving same-key followers", async () => {
      const leader = Promise.withResolvers<number>();
      let calls = 0;
      const memoized = memoizeAsync(
        (key: string) => {
          calls++;
          return key === "shared" ? leader.promise : Promise.resolve(key.length);
        },
        (key) => key,
        { maxEntries: 2, maxInflight: 1 },
      );

      const first = memoized("shared");
      const follower = memoized("shared");
      assertEquals(first, follower);
      await assertRejects(
        () => memoized("other"),
        RangeError,
        "capacity",
      );
      assertEquals(calls, 1);

      leader.resolve(6);
      assertEquals(await Promise.all([first, follower]), [6, 6]);
      assertEquals(await memoized("other"), 5);
      assertEquals(calls, 2);
    });

    it("releases in-flight capacity after rejection", async () => {
      const memoized = memoizeAsync(
        (key: string) =>
          key === "failed"
            ? Promise.reject(new Error("failed operation"))
            : Promise.resolve(key.length),
        (key) => key,
        { maxInflight: 1 },
      );

      await assertRejects(() => memoized("failed"), Error, "failed operation");
      assertEquals(await memoized("next"), 4);
    });

    it("evicts resolved async results by least-recently-used order", async () => {
      let calls = 0;
      const memoized = memoizeAsync(
        (key: string) => {
          calls++;
          return Promise.resolve(key.toUpperCase());
        },
        (key) => key,
        { maxEntries: 1 },
      );

      assertEquals(await memoized("a"), "A");
      assertEquals(await memoized("b"), "B");
      assertEquals(await memoized("a"), "A");
      assertEquals(calls, 3);
    });

    it("validates async budgets and rejects oversized keys as promises", async () => {
      for (
        const maxInflight of [
          0,
          -1,
          1.5,
          Number.NaN,
          Number.POSITIVE_INFINITY,
          MAX_MEMOIZE_INFLIGHT + 1,
        ]
      ) {
        assertThrows(
          () =>
            memoizeAsync(
              () => Promise.resolve(1),
              () => "key",
              { maxInflight },
            ),
          RangeError,
          "maxInflight",
        );
      }

      const memoized = memoizeAsync(
        (key: string) => Promise.resolve(key),
        (key) => key,
      );
      await assertRejects(
        () => memoized("k".repeat(MAX_MEMO_KEY_CHARACTERS + 1)),
        RangeError,
        "key",
      );
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

    it("distinguishes argument boundaries and primitive types", () => {
      assertNotEquals(simpleHash("ab", "c"), simpleHash("a", "bc"));
      assertNotEquals(simpleHash("1"), simpleHash(1));
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
