import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createSemaphore,
  getApiSemaphore,
  parallelAll,
  parallelFilter,
  parallelFind,
  parallelMap,
} from "./parallel.ts";

describe("parallel", () => {
  describe("parallelMap", () => {
    it("should return empty array for empty input", async () => {
      const result = await parallelMap([], async (x) => x);
      assertEquals(result, []);
    });

    it("should map items in parallel", async () => {
      const result = await parallelMap([1, 2, 3], async (x) => x * 2, {
        semaphore: createSemaphore(10),
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
        { semaphore: createSemaphore(10) },
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
        { semaphore: createSemaphore(10) },
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
        { semaphore: createSemaphore(2) },
      );

      assertEquals(maxConcurrent, 2);
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
        { semaphore: createSemaphore(10) },
      );
      assertEquals(result, [1, "two", true]);
    });

    it("should handle empty function array", async () => {
      const result = await parallelAll([] as const, {
        semaphore: createSemaphore(10),
      });
      assertEquals(result, []);
    });
  });

  describe("parallelFind", () => {
    it("should return undefined for empty input", async () => {
      const result = await parallelFind([], async () => true, {
        semaphore: createSemaphore(10),
      });
      assertEquals(result, undefined);
    });

    it("should find the first matching item by original order", async () => {
      const result = await parallelFind([1, 2, 3, 4, 5], async (x) => x > 2, {
        semaphore: createSemaphore(10),
      });
      assertEquals(result, 3);
    });

    it("should return undefined when no item matches", async () => {
      const result = await parallelFind([1, 2, 3], async (x) => x > 10, {
        semaphore: createSemaphore(10),
      });
      assertEquals(result, undefined);
    });

    it("should find single matching item", async () => {
      const result = await parallelFind([10, 20, 30], async (x) => x === 20, {
        semaphore: createSemaphore(10),
      });
      assertEquals(result, 20);
    });
  });

  describe("parallelFilter", () => {
    it("should filter items based on predicate", async () => {
      const result = await parallelFilter([1, 2, 3, 4, 5], async (x) => x % 2 === 0, {
        semaphore: createSemaphore(10),
      });
      assertEquals(result, [2, 4]);
    });

    it("should return empty array when nothing matches", async () => {
      const result = await parallelFilter([1, 2, 3], async () => false, {
        semaphore: createSemaphore(10),
      });
      assertEquals(result, []);
    });

    it("should return all items when everything matches", async () => {
      const result = await parallelFilter([1, 2, 3], async () => true, {
        semaphore: createSemaphore(10),
      });
      assertEquals(result, [1, 2, 3]);
    });

    it("should handle empty input", async () => {
      const result = await parallelFilter([], async () => true, {
        semaphore: createSemaphore(10),
      });
      assertEquals(result, []);
    });
  });

  describe("createSemaphore", () => {
    it("should create a semaphore with given permits", () => {
      const sem = createSemaphore(5);
      assertEquals(typeof sem, "object");
    });
  });

  describe("getApiSemaphore", () => {
    it("should return the shared API semaphore", () => {
      const sem = getApiSemaphore();
      assertEquals(typeof sem, "object");
    });

    it("should return the same instance on multiple calls", () => {
      const sem1 = getApiSemaphore();
      const sem2 = getApiSemaphore();
      assertEquals(sem1, sem2);
    });
  });
});
