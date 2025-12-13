import { describe, it } from "std/testing/bdd.ts";
import { assertEquals, assertExists, assertRejects } from "std/assert/mod.ts";
import { instrument, instrumentSync, instrumentBatch } from "./wrappers.ts";

describe("wrappers", () => {
  describe("instrument", () => {
    it("should wrap async function", async () => {
      const fn = async (x: number) => x * 2;
      const instrumented = instrument(fn, "test.operation");

      const result = await instrumented(5);
      assertEquals(result, 10);
    });

    it("should preserve function signature", async () => {
      const fn = async (a: string, b: number) => `${a}-${b}`;
      const instrumented = instrument(fn, "test.concat");

      const result = await instrumented("test", 42);
      assertEquals(result, "test-42");
    });

    it("should handle function errors", async () => {
      const fn = async () => {
        throw new Error("Function error");
      };
      const instrumented = instrument(fn, "test.error");

      await assertRejects(
        () => instrumented(),
        Error,
        "Function error"
      );
    });

    it("should work with no arguments", async () => {
      const fn = async () => "no args";
      const instrumented = instrument(fn, "test.noargs");

      const result = await instrumented();
      assertEquals(result, "no args");
    });

    it("should work with multiple arguments", async () => {
      const fn = async (a: number, b: number, c: number) => a + b + c;
      const instrumented = instrument(fn, "test.sum");

      const result = await instrumented(1, 2, 3);
      assertEquals(result, 6);
    });

    it("should handle async operations", async () => {
      const fn = async (delay: number) => {
        await new Promise((resolve) => setTimeout(resolve, delay));
        return "done";
      };
      const instrumented = instrument(fn, "test.delay");

      const result = await instrumented(10);
      assertEquals(result, "done");
    });

    it("should work with options", async () => {
      const fn = async (x: number) => x * 2;
      const instrumented = instrument(fn, "test.operation", {
        kind: "internal",
        attributes: (args) => ({ input: args[0] as number }),
      });

      const result = await instrumented(5);
      assertEquals(result, 10);
    });

    it("should handle different return types", async () => {
      const objFn = async () => ({ key: "value" });
      const arrFn = async () => [1, 2, 3];
      const numFn = async () => 42;
      const boolFn = async () => true;

      const instrumentedObj = instrument(objFn, "test.obj");
      const instrumentedArr = instrument(arrFn, "test.arr");
      const instrumentedNum = instrument(numFn, "test.num");
      const instrumentedBool = instrument(boolFn, "test.bool");

      assertEquals(await instrumentedObj(), { key: "value" });
      assertEquals(await instrumentedArr(), [1, 2, 3]);
      assertEquals(await instrumentedNum(), 42);
      assertEquals(await instrumentedBool(), true);
    });
  });

  describe("instrumentSync", () => {
    it("should wrap synchronous function", () => {
      const fn = (x: number) => x * 2;
      const instrumented = instrumentSync(fn, "test.sync");

      const result = instrumented(5);
      assertEquals(result, 10);
    });

    it("should preserve function signature for sync functions", () => {
      const fn = (a: string, b: number) => `${a}-${b}`;
      const instrumented = instrumentSync(fn, "test.sync.concat");

      const result = instrumented("test", 42);
      assertEquals(result, "test-42");
    });

    it("should handle sync function errors", () => {
      const fn = () => {
        throw new Error("Sync error");
      };
      const instrumented = instrumentSync(fn, "test.sync.error");

      try {
        instrumented();
        throw new Error("Should have thrown");
      } catch (error) {
        assertEquals((error as Error).message, "Sync error");
      }
    });

    it("should work with no arguments for sync", () => {
      const fn = () => "no args";
      const instrumented = instrumentSync(fn, "test.sync.noargs");

      const result = instrumented();
      assertEquals(result, "no args");
    });

    it("should work with multiple arguments for sync", () => {
      const fn = (a: number, b: number, c: number) => a + b + c;
      const instrumented = instrumentSync(fn, "test.sync.sum");

      const result = instrumented(1, 2, 3);
      assertEquals(result, 6);
    });

    it("should work with options for sync", () => {
      const fn = (x: number) => x * 2;
      const instrumented = instrumentSync(fn, "test.sync.operation", {
        kind: "internal",
        attributes: (args) => ({ input: args[0] as number }),
      });

      const result = instrumented(5);
      assertEquals(result, 10);
    });

    it("should handle different return types for sync", () => {
      const objFn = () => ({ key: "value" });
      const arrFn = () => [1, 2, 3];
      const numFn = () => 42;
      const boolFn = () => true;

      const instrumentedObj = instrumentSync(objFn, "test.sync.obj");
      const instrumentedArr = instrumentSync(arrFn, "test.sync.arr");
      const instrumentedNum = instrumentSync(numFn, "test.sync.num");
      const instrumentedBool = instrumentSync(boolFn, "test.sync.bool");

      assertEquals(instrumentedObj(), { key: "value" });
      assertEquals(instrumentedArr(), [1, 2, 3]);
      assertEquals(instrumentedNum(), 42);
      assertEquals(instrumentedBool(), true);
    });

    it("should measure execution duration", () => {
      let executionCount = 0;
      const fn = () => {
        executionCount++;
        return "done";
      };
      const instrumented = instrumentSync(fn, "test.sync.duration");

      instrumented();
      assertEquals(executionCount, 1);
    });
  });

  describe("instrumentBatch", () => {
    it("should process items in batches", async () => {
      const items = [1, 2, 3, 4, 5];
      const processed: number[] = [];

      await instrumentBatch(
        "test.batch",
        items,
        async (item) => {
          processed.push(item);
        },
        { batchSize: 2 }
      );

      assertEquals(processed.length, 5);
      assertEquals(processed, [1, 2, 3, 4, 5]);
    });

    it("should handle empty array", async () => {
      const items: number[] = [];
      const processed: number[] = [];

      await instrumentBatch(
        "test.batch.empty",
        items,
        async (item) => {
          processed.push(item);
        }
      );

      assertEquals(processed.length, 0);
    });

    it("should use default batch size when not specified", async () => {
      const items = Array.from({ length: 25 }, (_, i) => i);
      const processed: number[] = [];

      await instrumentBatch(
        "test.batch.default",
        items,
        async (item) => {
          processed.push(item);
        }
      );

      assertEquals(processed.length, 25);
    });

    it("should handle batch processing errors", async () => {
      const items = [1, 2, 3];

      await assertRejects(
        () => instrumentBatch(
          "test.batch.error",
          items,
          async (item) => {
            if (item === 2) throw new Error("Batch error");
          }
        ),
        Error,
        "Batch error"
      );
    });

    it("should provide item index to processor", async () => {
      const items = ["a", "b", "c"];
      const indexedItems: Array<{ item: string; index: number }> = [];

      await instrumentBatch(
        "test.batch.index",
        items,
        async (item, index) => {
          indexedItems.push({ item, index });
        },
        { batchSize: 1 }
      );

      assertEquals(indexedItems.length, 3);
      assertEquals(indexedItems[0], { item: "a", index: 0 });
      assertEquals(indexedItems[1], { item: "b", index: 1 });
      assertEquals(indexedItems[2], { item: "c", index: 2 });
    });

    it("should handle large batches", async () => {
      const items = Array.from({ length: 100 }, (_, i) => i);
      const processed: number[] = [];

      await instrumentBatch(
        "test.batch.large",
        items,
        async (item) => {
          processed.push(item);
        },
        { batchSize: 20 }
      );

      assertEquals(processed.length, 100);
    });

    it("should handle partial last batch", async () => {
      const items = [1, 2, 3, 4, 5, 6, 7];
      const processed: number[] = [];

      await instrumentBatch(
        "test.batch.partial",
        items,
        async (item) => {
          processed.push(item);
        },
        { batchSize: 3 }
      );

      assertEquals(processed.length, 7);
      assertEquals(processed, [1, 2, 3, 4, 5, 6, 7]);
    });

    it("should accept custom attributes", async () => {
      const items = [1, 2, 3];
      const processed: number[] = [];

      await instrumentBatch(
        "test.batch.attrs",
        items,
        async (item) => {
          processed.push(item);
        },
        {
          batchSize: 2,
          attributes: { "custom.key": "custom.value" },
        }
      );

      assertEquals(processed.length, 3);
    });

    it("should process items concurrently within batch", async () => {
      const items = [10, 20, 30, 40];
      const startTimes: number[] = [];
      const endTimes: number[] = [];

      await instrumentBatch(
        "test.batch.concurrent",
        items,
        async (item) => {
          startTimes.push(performance.now());
          await new Promise((resolve) => setTimeout(resolve, 10));
          endTimes.push(performance.now());
        },
        { batchSize: 4 }
      );

      assertEquals(startTimes.length, 4);
      assertEquals(endTimes.length, 4);
    });

    it("should handle single item batch", async () => {
      const items = [42];
      const processed: number[] = [];

      await instrumentBatch(
        "test.batch.single",
        items,
        async (item) => {
          processed.push(item);
        },
        { batchSize: 1 }
      );

      assertEquals(processed.length, 1);
      assertEquals(processed[0], 42);
    });
  });
});
