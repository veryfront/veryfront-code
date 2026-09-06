import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { Semaphore } from "#veryfront/modules/react-loader/ssr-module-loader/concurrency/semaphore.ts";
import { TIMEOUT_ERROR } from "#veryfront/errors/error-registry.ts";
import { VeryfrontError } from "#veryfront/errors/types.ts";
import { parallelAll, parallelMap } from "./parallel.ts";

describe("parallel", () => {
  describe("parallelMap", () => {
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

    it("should enforce the declarative concurrency limit", async () => {
      let concurrent = 0;
      let maxConcurrent = 0;

      await parallelMap([1, 2, 3, 4], async () => {
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await new Promise((resolve) => setTimeout(resolve, 10));
        concurrent--;
      }, { concurrency: 2 });

      assertEquals(maxConcurrent, 2);
    });

    it("should release the permit when a mapper rejects", async () => {
      const semaphore = new Semaphore(2);
      const boom = new Error("mapper failed");

      const error = await assertRejects(
        () => parallelMap([1], () => Promise.reject(boom), { semaphore }),
        Error,
        "mapper failed",
      );

      assertStrictEquals(
        error,
        boom,
        "the mapper's rejection must propagate unchanged",
      );
      assertEquals(
        semaphore.available,
        2,
        "a rejecting mapper must still release its permit",
      );
      assertEquals(
        semaphore.waiting,
        0,
        "no waiter may be left queued after a rejection",
      );
      assertEquals(
        await parallelMap([1, 2], async (x) => x * 2, { semaphore }),
        [2, 4],
        "the semaphore must still be usable after a failed run",
      );
    });

    it("should surface semaphore backpressure as a timeout error", async () => {
      const semaphore = new Semaphore(1);
      assertEquals(
        await semaphore.tryAcquire(1_000),
        true,
        "the only permit must be drained before the run",
      );

      const error = await assertRejects(
        () => parallelMap([1], async (x) => x, { semaphore, timeoutMs: 10 }),
        VeryfrontError,
        "timed out waiting for semaphore",
      );

      assertEquals(
        (error as VeryfrontError).slug,
        TIMEOUT_ERROR.slug,
        "semaphore backpressure must be classified as timeout-error",
      );

      semaphore.release();
    });

    it("should reject an invalid declarative concurrency limit", async () => {
      for (const concurrency of [0, -1, 1.5, Number.NaN]) {
        let calls = 0;

        await assertRejects(
          () =>
            parallelMap([1], (x) => {
              calls++;
              return Promise.resolve(x);
            }, { concurrency }),
          RangeError,
          "positive safe integer",
          `concurrency ${concurrency} must be rejected up front`,
        );

        assertEquals(
          calls,
          0,
          `concurrency ${concurrency} must be rejected before any mapper runs`,
        );
      }
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

    it("rejects a sparse function array", async () => {
      const sparse = new Array<() => Promise<number>>(1);
      await assertRejects(
        () => parallelAll(sparse),
        TypeError,
      );
    });
  });
});
