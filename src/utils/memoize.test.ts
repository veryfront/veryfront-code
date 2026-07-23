import "#veryfront/schemas/_test-setup.ts";
import {
  assert,
  assertEquals,
  assertNotEquals,
  assertRejects,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { delay } from "#std/async.ts";
import { MemoCache, memoize, memoizeAsync, simpleHash } from "./memoize.ts";

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

    it("evicts the least recently used entry at its configured bound", () => {
      const cache = new MemoCache<number>(2);
      cache.set("first", 1);
      cache.set("second", 2);
      assertEquals(cache.get("first"), 1);

      cache.set("third", 3);

      assertEquals(cache.has("first"), true);
      assertEquals(cache.has("second"), false);
      assertEquals(cache.has("third"), true);
    });

    it("rejects invalid cache bounds", () => {
      for (const maxEntries of [0, -1, 1.5, Number.POSITIVE_INFINITY]) {
        assertThrows(
          () => new MemoCache(maxEntries),
          Error,
          "positive safe integer",
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
      const fn = async (msg: string): Promise<string> => {
        await delay(1);
        return `processed: ${msg}`;
      };
      const memoized = memoizeAsync(fn, (msg) => msg);

      assertEquals(await memoized("hello"), "processed: hello");
    });

    it("deduplicates compliant non-native thenables", async () => {
      let callCount = 0;
      let resolveValue: ((value: number) => void) | undefined;
      const value = new Promise<number>((resolve) => {
        resolveValue = resolve;
      });
      const thenable = { then: value.then.bind(value) } as Promise<number>;
      const memoized = memoizeAsync(
        () => {
          callCount++;
          return thenable;
        },
        () => "key",
      );

      const first = memoized();
      const second = memoized();
      assertEquals(callCount, 1);
      resolveValue?.(42);
      assertEquals(await Promise.all([first, second]), [42, 42]);
    });

    it("does not cache a hostile thenable that rejects during assimilation", async () => {
      let callCount = 0;
      const privateValue = "private-thenable-failure";
      const memoized = memoizeAsync(
        () => {
          callCount++;
          return Object.defineProperty({}, "then", {
            get() {
              throw new Error(privateValue);
            },
          }) as Promise<number>;
        },
        () => "key",
      );

      await assertRejects(() => memoized(), Error, privateValue);
      await assertRejects(() => memoized(), Error, privateValue);
      assertEquals(callCount, 2);
    });

    it("registers in-flight work before invoking a re-entrant operation", async () => {
      let callCount = 0;
      let entered = false;
      let nested: Promise<number> | undefined;
      const memoized: () => Promise<number> = memoizeAsync(
        () => {
          callCount++;
          if (!entered) {
            entered = true;
            nested = memoized();
          }
          return Promise.resolve(42);
        },
        () => "key",
      );

      const outer = memoized();
      assert(nested);
      assertEquals(await Promise.all([outer, nested]), [42, 42]);
      assertEquals(callCount, 1);
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

    it("preserves argument boundaries", () => {
      assertNotEquals(simpleHash("ab", "c"), simpleHash("a", "bc"));
    });

    it("preserves primitive type boundaries", () => {
      assertNotEquals(simpleHash(1), simpleHash("1"));
      assertNotEquals(simpleHash(null), simpleHash("null"));
    });

    it("avoids known 32-bit collisions in memoization keys", () => {
      assertNotEquals(
        simpleHash("v-20922-3241147255"),
        simpleHash("v-124136-4293473261"),
      );
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
