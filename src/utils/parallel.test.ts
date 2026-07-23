import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { Semaphore } from "#veryfront/modules/react-loader/ssr-module-loader/concurrency/semaphore.ts";
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

    it("uses the concurrency option as a per-call limit", async () => {
      let concurrent = 0;
      let maxConcurrent = 0;

      await parallelMap(
        [1, 2, 3, 4, 5, 6],
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

    it("bounds semaphore waiters to the configured worker count", async () => {
      const semaphore = new Semaphore(1);
      let releaseOperations: (() => void) | undefined;
      const operationsMayFinish = new Promise<void>((resolve) => {
        releaseOperations = resolve;
      });

      const result = parallelMap(
        Array.from({ length: 100 }, (_, index) => index),
        async (value) => {
          await operationsMayFinish;
          return value;
        },
        { concurrency: 3, semaphore, timeoutMs: 1_000 },
      );

      await new Promise((resolve) => setTimeout(resolve, 0));
      assertEquals(semaphore.waiting, 2);

      releaseOperations?.();
      assertEquals((await result).length, 100);
    });

    it("rejects invalid numeric options", async () => {
      for (const concurrency of [0, -1, 1.5, Number.POSITIVE_INFINITY]) {
        await assertRejects(
          () => parallelMap([1], async (value) => value, { concurrency }),
          Error,
          "positive safe integer",
        );
      }

      for (const timeoutMs of [-1, 1.5, 2_147_483_648, Number.POSITIVE_INFINITY]) {
        await assertRejects(
          () => parallelMap([1], async (value) => value, { timeoutMs }),
          Error,
          "non-negative safe integer",
        );
      }
    });

    it("sanitizes unreadable options", async () => {
      const privateValue = "private-parallel-option";
      const options = Object.defineProperty({}, "concurrency", {
        get() {
          throw new Error(privateValue);
        },
      });

      const error = await parallelMap([1], async (value) => value, options).then(
        () => undefined,
        (reason: unknown) => reason,
      );
      assert(error instanceof Error);
      assert(error.message.includes("Parallel options are not readable"));
      assert(!error.message.includes(privateValue));
    });

    it("uses a stable snapshot when the input array is mutated", async () => {
      const items = [1, 2];
      let releaseFirst: (() => void) | undefined;
      const firstMayFinish = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      const result = parallelMap(
        items,
        async (value, index) => {
          if (index === 0) await firstMayFinish;
          return value;
        },
        { concurrency: 1 },
      );

      items.push(3);
      releaseFirst?.();
      assertEquals(await result, [1, 2]);
    });

    it("preserves sparse-array mapping semantics", async () => {
      const items = new Array<number>(3);
      items[1] = 2;
      const visited: number[] = [];

      const result = await parallelMap(items, async (value, index) => {
        visited.push(index);
        return value * 2;
      });

      assertEquals(visited, [1]);
      assertEquals(0 in result, false);
      assertEquals(result[1], 4);
      assertEquals(2 in result, false);
    });

    it("sanitizes unreadable input arrays", async () => {
      const { proxy, revoke } = Proxy.revocable([], {});
      revoke();

      const error = await parallelMap(proxy, async (value) => value).then(
        () => undefined,
        (reason: unknown) => reason,
      );
      assert(error instanceof Error);
      assert(error.message.includes("Parallel items are not readable"));
      assert(!error.message.includes("IsArray"));
    });

    it("rejects promptly when a sibling operation remains pending", async () => {
      let resolvePending: (() => void) | undefined;
      const pending = new Promise<void>((resolve) => {
        resolvePending = resolve;
      });
      const result = parallelMap(
        ["pending", "failure"],
        async (value) => {
          if (value === "pending") await pending;
          else throw new Error("parallel failure");
          return value;
        },
        { concurrency: 2 },
      );

      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<"timed-out">((resolve) => {
        timeoutId = setTimeout(() => resolve("timed-out"), 25);
      });
      const outcome = await Promise.race([
        result.then(
          () => "resolved",
          () => "rejected",
        ),
        timeout,
      ]);
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      resolvePending?.();

      assertEquals(outcome, "rejected");
      await assertRejects(() => result, Error, "parallel failure");
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

    it("returns a sanitized rejection for an unreadable function array", async () => {
      const { proxy, revoke } = Proxy.revocable<Array<() => Promise<unknown>>>([], {});
      revoke();

      let threwSynchronously = false;
      let result: Promise<readonly unknown[]> | undefined;
      try {
        result = parallelAll(proxy);
      } catch {
        threwSynchronously = true;
      }

      assertEquals(threwSynchronously, false);
      await assertRejects(
        () => result!,
        Error,
        "Parallel items are not readable",
      );
    });
  });
});
