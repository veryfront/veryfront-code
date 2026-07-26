import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { Semaphore } from "#veryfront/modules/react-loader/ssr-module-loader/concurrency/semaphore.ts";
import { parallelAll, parallelMap } from "./parallel.ts";

describe("parallel", () => {
  describe("parallelMap", () => {
    it("rejects timeout values unsupported by JavaScript timers", async () => {
      for (
        const timeoutMs of [
          -1,
          1.5,
          Number.NaN,
          Number.POSITIVE_INFINITY,
          2_147_483_648,
        ]
      ) {
        await assertRejects(
          () => parallelMap([1], async (value) => value, { timeoutMs }),
          RangeError,
        );
      }
    });

    it("should return empty array for empty input", async () => {
      const result = await parallelMap([], async (x) => x);
      assertEquals(result, []);
    });

    it("should map items in parallel", async () => {
      const result = await parallelMap([1, 2, 3], async (x) => x * 2, {
        semaphore: new Semaphore(10),
      });
      assertEquals(result, [2, 4, 6]);
    });

    it("should preserve order regardless of completion time", async () => {
      const result = await parallelMap(
        [3, 1, 2],
        async (x) => {
          await new Promise((r) => setTimeout(r, x * 10));
          return x * 10;
        },
        { semaphore: new Semaphore(10) },
      );
      assertEquals(result, [30, 10, 20]);
    });

    it("should pass index to the mapping function", async () => {
      const indices: number[] = [];

      await parallelMap(
        ["a", "b", "c"],
        async (_item, index) => {
          indices.push(index);
          return index;
        },
        { semaphore: new Semaphore(10) },
      );

      // All indices should be present (order may vary due to parallelism)
      assertEquals(indices.sort(), [0, 1, 2]);
    });

    it("should respect semaphore concurrency limits", async () => {
      let concurrent = 0;
      let maxConcurrent = 0;

      await parallelMap(
        [1, 2, 3, 4],
        async () => {
          concurrent++;
          maxConcurrent = Math.max(maxConcurrent, concurrent);
          await new Promise((r) => setTimeout(r, 30));
          concurrent--;
        },
        { semaphore: new Semaphore(2) },
      );

      assertEquals(maxConcurrent, 2);
    });

    it("should respect the concurrency option without an explicit semaphore", async () => {
      let concurrent = 0;
      let maxConcurrent = 0;

      await parallelMap(
        [1, 2, 3, 4],
        async () => {
          concurrent++;
          maxConcurrent = Math.max(maxConcurrent, concurrent);
          await new Promise((resolve) => setTimeout(resolve, 10));
          concurrent--;
        },
        { concurrency: 2 },
      );

      assertEquals(maxConcurrent, 2);
    });

    it("bounds admission work instead of queueing the complete input", async () => {
      const semaphore = new Semaphore(1);
      await semaphore.tryAcquire();

      const pending = parallelMap(
        Array.from({ length: 100 }, (_, index) => index),
        async (value) => value,
        {
          concurrency: 3,
          semaphore,
          timeoutMs: 1_000,
        },
      );

      await Promise.resolve();
      assertEquals(semaphore.waiting, 3);
      semaphore.release();
      assertEquals(await pending, Array.from({ length: 100 }, (_, index) => index));
    });

    it("does not return while sibling work from the same call is still running", async () => {
      const blocker = Promise.withResolvers<void>();
      const siblingStarted = Promise.withResolvers<void>();
      const failureThrown = Promise.withResolvers<void>();
      let settled = false;
      const operation = parallelMap(
        ["fail", "block"],
        async (value) => {
          if (value === "fail") {
            await siblingStarted.promise;
            failureThrown.resolve();
            throw new Error("mapping failed");
          }
          siblingStarted.resolve();
          await blocker.promise;
          return value;
        },
        { concurrency: 2 },
      );
      const observed = operation.then(
        () => {
          settled = true;
          return undefined;
        },
        (error) => {
          settled = true;
          return error;
        },
      );

      await failureThrown.promise;
      await new Promise((resolve) => setTimeout(resolve, 0));
      assertEquals(settled, false);

      blocker.resolve();
      const error = await observed;
      assertEquals(error instanceof Error, true);
      assertEquals((error as Error).message, "mapping failed");
    });
  });

  describe("parallelAll", () => {
    it("should execute all functions and return results", async () => {
      const result = await parallelAll(
        [
          () => Promise.resolve(1),
          () => Promise.resolve("two"),
          () => Promise.resolve(true),
        ] as const,
        { semaphore: new Semaphore(10) },
      );
      assertEquals(result, [1, "two", true]);
    });

    it("should handle empty function array", async () => {
      const result = await parallelAll([] as const, {
        semaphore: new Semaphore(10),
      });
      assertEquals(result, []);
    });
  });
});
