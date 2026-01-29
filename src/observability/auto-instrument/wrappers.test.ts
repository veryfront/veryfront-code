import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { instrument, instrumentBatch, instrumentSync } from "./wrappers.ts";

describe("observability/auto-instrument/wrappers", () => {
  describe("instrument (async wrapper)", () => {
    it("should wrap an async function and preserve its result", async () => {
      const fn = (x: number) => x * 2;
      const wrapped = instrument(fn, "test.double") as (x: number) => Promise<number>;
      const result = await wrapped(5);
      assertEquals(result, 10);
    });

    it("should preserve function arguments", async () => {
      const fn = (a: string, b: string) => `${a}-${b}`;
      const wrapped = instrument(fn, "test.concat") as (
        a: string,
        b: string,
      ) => Promise<string>;
      const result = await wrapped("hello", "world");
      assertEquals(result, "hello-world");
    });

    it("should rethrow errors from the wrapped function", async () => {
      const fn = (): never => {
        throw new Error("async failure");
      };
      const wrapped = instrument(fn, "test.fail");
      await assertRejects(() => wrapped(), Error, "async failure");
    });

    it("should accept instrument options with kind", async () => {
      const fn = () => "ok";
      const wrapped = instrument(fn, "test.server", { kind: "server" });
      const result = await wrapped();
      assertEquals(result, "ok");
    });

    it("should accept instrument options with attributes factory", async () => {
      const fn = (userId: string) => userId;
      const wrapped = instrument(fn, "test.user", {
        attributes: (args) => ({ userId: args[0] as string }),
      }) as (userId: string) => Promise<string>;
      const result = await wrapped("u-123");
      assertEquals(result, "u-123");
    });

    it("should handle functions that return resolved promises", async () => {
      const fn = (x: number): Promise<number> => Promise.resolve(x + 1);
      const wrapped = instrument(fn, "test.inc") as (x: number) => Promise<number>;
      assertEquals(await wrapped(9), 10);
    });

    it("should handle functions that return rejected promises", async () => {
      const fn = (): Promise<never> => Promise.reject(new Error("rejected"));
      const wrapped = instrument(fn, "test.reject");
      await assertRejects(() => wrapped(), Error, "rejected");
    });
  });

  describe("instrumentSync (sync wrapper)", () => {
    it("should wrap a sync function and preserve its result", () => {
      const fn = (x: number): number => x * 3;
      const wrapped = instrumentSync(fn, "test.triple") as (x: number) => number;
      assertEquals(wrapped(4), 12);
    });

    it("should preserve function arguments", () => {
      const fn = (a: number, b: number): number => a + b;
      const wrapped = instrumentSync(fn, "test.add") as (
        a: number,
        b: number,
      ) => number;
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
      }) as (name: string) => string;
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
      await instrumentBatch("test.batch", [1, 2, 3], (item) => {
        results.push(item * 2);
      });
      assertEquals(results, [2, 4, 6]);
    });

    it("should process empty array without error", async () => {
      let called = false;
      await instrumentBatch("test.empty", [], () => {
        called = true;
      });
      assertEquals(called, false);
    });

    it("should pass correct indices to processor", async () => {
      const indices: number[] = [];
      await instrumentBatch("test.indices", ["a", "b", "c"], (_item, index) => {
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
        (item) => {
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
      await instrumentBatch("test.default-size", items, (item) => {
        processed.push(item);
      });
      assertEquals(processed.length, 25);
    });

    it("should rethrow errors from processor", async () => {
      await assertRejects(
        () =>
          instrumentBatch("test.error", [1, 2, 3], (item) => {
            if (item === 2) throw new Error("batch item error");
          }),
        Error,
        "batch item error",
      );
    });

    it("should accept batch attributes", async () => {
      await instrumentBatch("test.attrs", [1], () => {}, {
        attributes: { operation: "test", source: "unit" },
      });
      // Should not throw
    });

    it("should handle single-item batch", async () => {
      const results: number[] = [];
      await instrumentBatch("test.single", [42], (item) => {
        results.push(item);
      });
      assertEquals(results, [42]);
    });

    it("should handle batch size larger than items", async () => {
      const results: string[] = [];
      await instrumentBatch(
        "test.oversized",
        ["a", "b"],
        (item) => {
          results.push(item);
        },
        { batchSize: 100 },
      );
      assertEquals(results, ["a", "b"]);
    });
  });
});
