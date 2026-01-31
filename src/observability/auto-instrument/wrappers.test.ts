import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { instrument, instrumentBatch, instrumentSync } from "./wrappers.ts";

describe("observability/auto-instrument/wrappers", () => {
  describe("instrument (async wrapper)", () => {
    it("should wrap an async function and preserve its result", async () => {
      const fn = (x: number): Promise<number> => Promise.resolve(x * 2);
      const wrapped = instrument(fn, "test.double");
      const result = await wrapped(5);
      assertEquals(result, 10);
    });

    it("should preserve function arguments", async () => {
      const fn = (a: string, b: string): Promise<string> => Promise.resolve(`${a}-${b}`);
      const wrapped = instrument(fn, "test.concat");
      const result = await wrapped("hello", "world");
      assertEquals(result, "hello-world");
    });

    it("should rethrow errors from the wrapped function", async () => {
      const fn = (): Promise<never> => {
        throw new Error("async failure");
      };
      const wrapped = instrument(fn, "test.fail");
      await assertRejects(() => wrapped(), Error, "async failure");
    });

    it("should accept instrument options with kind", async () => {
      const fn = (): Promise<string> => Promise.resolve("ok");
      const wrapped = instrument(fn, "test.server", { kind: "server" });
      const result = await wrapped();
      assertEquals(result, "ok");
    });

    it("should accept instrument options with attributes factory", async () => {
      const fn = (userId: string): Promise<string> => Promise.resolve(userId);
      const wrapped = instrument(fn, "test.user", {
        attributes: (args) => ({ userId: args[0] as string }),
      });
      const result = await wrapped("u-123");
      assertEquals(result, "u-123");
    });

    it("should handle functions that return resolved promises", async () => {
      const fn = (x: number): Promise<number> => Promise.resolve(x + 1);
      const wrapped = instrument(fn, "test.inc");
      assertEquals(await wrapped(9), 10);
    });

    it("should handle functions that return rejected promises", async () => {
      const fn = (): Promise<never> => {
        throw new Error("rejected");
      };
      const wrapped = instrument(fn, "test.reject");
      await assertRejects(() => wrapped(), Error, "rejected");
    });
  });

  describe("instrumentSync (sync wrapper)", () => {
    it("should wrap a sync function and preserve its result", () => {
      const fn = (x: number): number => x * 3;
      const wrapped = instrumentSync(fn, "test.triple");
      assertEquals(wrapped(4), 12);
    });

    it("should preserve function arguments", () => {
      const fn = (a: number, b: number): number => a + b;
      const wrapped = instrumentSync(fn, "test.add");
      assertEquals(wrapped(3, 7), 10);
    });

    it("should rethrow errors from the wrapped function", () => {
      const fn = (): never => {
        throw new Error("sync failure");
      };
      const wrapped = instrumentSync(fn, "test.fail");
      assertThrows(() => wrapped(), Error, "sync failure");
    });

    it("should accept instrument options with kind", () => {
      const fn = (): string => "ok";
      const wrapped = instrumentSync(fn, "test.internal", { kind: "internal" });
      assertEquals(wrapped(), "ok");
    });

    it("should accept instrument options with attributes factory", () => {
      const fn = (name: string): string => `Hello ${name}`;
      const wrapped = instrumentSync(fn, "test.greet", {
        attributes: (args) => ({ name: args[0] as string }),
      });
      assertEquals(wrapped("World"), "Hello World");
    });

    it("should handle functions returning various types", () => {
      assertEquals(instrumentSync(() => 42, "test.num")(), 42);
      assertEquals(instrumentSync(() => true, "test.bool")(), true);
      assertEquals(instrumentSync(() => null, "test.null")(), null);
      assertEquals(instrumentSync(() => undefined, "test.undef")(), undefined);
      const obj = { key: "value" };
      assertEquals(instrumentSync(() => obj, "test.obj")(), obj);
    });
  });

  describe("instrumentBatch", () => {
    it("should process all items", async () => {
      const results: number[] = [];
      // deno-lint-ignore require-await
      await instrumentBatch("test.batch", [1, 2, 3], async (item) => {
        results.push(item * 2);
      });
      assertEquals(results, [2, 4, 6]);
    });

    it("should process empty array without error", async () => {
      let called = false;
      // deno-lint-ignore require-await
      await instrumentBatch("test.empty", [], async () => {
        called = true;
      });
      assertEquals(called, false);
    });

    it("should pass correct indices to processor", async () => {
      const indices: number[] = [];
      // deno-lint-ignore require-await
      await instrumentBatch("test.indices", ["a", "b", "c"], async (_item, index) => {
        indices.push(index);
      });
      assertEquals(indices, [0, 1, 2]);
    });

    it("should respect custom batch size", async () => {
      const items = Array.from({ length: 15 }, (_, i) => i);
      const processed: number[] = [];
      await instrumentBatch(
        "test.sized",
        items,
        // deno-lint-ignore require-await
        async (item) => {
          processed.push(item);
        },
        { batchSize: 5 },
      );
      assertEquals(processed.length, 15);
      assertEquals(processed, items);
    });

    it("should default to batch size of 10", async () => {
      const items = Array.from({ length: 25 }, (_, i) => i);
      const processed: number[] = [];
      // deno-lint-ignore require-await
      await instrumentBatch("test.default-size", items, async (item) => {
        processed.push(item);
      });
      assertEquals(processed.length, 25);
    });

    it("should rethrow errors from processor", async () => {
      await assertRejects(
        () =>
          // deno-lint-ignore require-await
          instrumentBatch("test.error", [1, 2, 3], async (item) => {
            if (item === 2) throw new Error("batch item error");
          }),
        Error,
        "batch item error",
      );
    });

    it("should accept batch attributes", async () => {
      await instrumentBatch("test.attrs", [1], async () => {}, {
        attributes: { operation: "test", source: "unit" },
      });
    });

    it("should handle single-item batch", async () => {
      const results: number[] = [];
      // deno-lint-ignore require-await
      await instrumentBatch("test.single", [42], async (item) => {
        results.push(item);
      });
      assertEquals(results, [42]);
    });

    it("should handle batch size larger than items", async () => {
      const results: string[] = [];
      await instrumentBatch(
        "test.oversized",
        ["a", "b"],
        // deno-lint-ignore require-await
        async (item) => {
          results.push(item);
        },
        { batchSize: 100 },
      );
      assertEquals(results, ["a", "b"]);
    });
  });
});
