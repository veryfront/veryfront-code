/**
 * P1-5: Pipeline Timeout Enforcement Tests
 *
 * Spec: specs/rendering/ssr-orchestration.spec.md
 * Verifies: withTimeout (soft) and withTimeoutThrow (hard) behavior
 * at the three pipeline timeout stages.
 */
import { assertEquals, assertRejects } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { TimeoutError, withTimeout, withTimeoutThrow } from "./stream-utils.ts";

function delay<T>(ms: number, value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

function hang<T>(): Promise<T> {
  return new Promise(() => {});
}

describe("Timeout Enforcement", () => {
  describe("withTimeoutThrow (hard timeout)", () => {
    it("resolves normally when operation completes before timeout", async () => {
      const result = await withTimeoutThrow(delay(10, "success"), 500, "fast operation");
      assertEquals(result, "success");
    });

    it("throws TimeoutError when operation exceeds timeout", async () => {
      await assertRejects(
        () => withTimeoutThrow(hang(), 50, "slow operation"),
        TimeoutError,
        "slow operation timed out after 50ms",
      );
    });

    it("includes label and duration in TimeoutError message", async () => {
      await assertRejects(
        () => withTimeoutThrow(hang(), 50, "Module loading for blog/post"),
        TimeoutError,
        "Module loading for blog/post timed out after 50ms",
      );
    });

    it("returns result of winning promise in race", async () => {
      const result = await withTimeoutThrow(delay(10, 42), 1000, "fast wins");
      assertEquals(result, 42);
    });

    it("propagates errors from the wrapped promise", async () => {
      const failing = Promise.reject(new Error("operation failed"));

      await assertRejects(
        () => withTimeoutThrow(failing, 1000, "failing op"),
        Error,
        "operation failed",
      );
    });
  });

  describe("withTimeout (soft timeout)", () => {
    it("resolves normally when operation completes before timeout", async () => {
      const result = await withTimeout(delay(10, "success"), 500, "fast operation");
      assertEquals(result, "success");
    });

    it("returns undefined when operation exceeds timeout (no throw)", async () => {
      const result = await withTimeout(hang(), 50, "slow operation");
      assertEquals(result, undefined);
    });

    it("does not throw on timeout", async () => {
      const result = await withTimeout(hang(), 50, "CSS generation");
      assertEquals(result, undefined);
    });
  });

  describe("pipeline timeout constants (simulated)", () => {
    // These tests verify the timeout mechanism works at small scales.
    // The actual constants are 10s/15s/20s but we use small values for test speed.

    it("MODULE_LOAD_TIMEOUT: throws on module loading hang", async () => {
      const moduleLoadTimeout = 50; // Real: 10_000

      await assertRejects(
        () => withTimeoutThrow(hang(), moduleLoadTimeout, "Module loading for blog/post"),
        TimeoutError,
      );
    });

    it("DATA_FETCH_TIMEOUT: throws on data fetch hang", async () => {
      const dataFetchTimeout = 50; // Real: 15_000

      await assertRejects(
        () => withTimeoutThrow(hang(), dataFetchTimeout, "Data fetch for blog/post"),
        TimeoutError,
      );
    });

    it("SSR_RENDER_TIMEOUT: throws on SSR render hang", async () => {
      const ssrRenderTimeout = 50; // Real: 20_000

      await assertRejects(
        () => withTimeoutThrow(hang(), ssrRenderTimeout, "SSR rendering for blog/post"),
        TimeoutError,
      );
    });

    it("CSS_SSR_TIMEOUT: returns undefined on CSS generation hang (soft)", async () => {
      const cssSsrTimeout = 50; // Real: 5_000

      const result = await withTimeout(hang(), cssSsrTimeout, "CSS generation");
      assertEquals(result, undefined);
    });
  });

  describe("timeout cleanup", () => {
    it("clears timeout when promise resolves before deadline", async () => {
      const results: string[] = [];

      for (let i = 0; i < 10; i++) {
        results.push(
          await withTimeoutThrow(delay(5, `result-${i}`), 1000, `iteration-${i}`),
        );
      }

      assertEquals(results.length, 10);
      assertEquals(results[0], "result-0");
      assertEquals(results[9], "result-9");
    });
  });

  describe("parallel timeout enforcement", () => {
    it("independent timeouts for parallel operations", async () => {
      const results = await Promise.all([
        withTimeoutThrow(delay(10, "job-1"), 500, "data job 1"),
        withTimeoutThrow(delay(20, "job-2"), 500, "data job 2"),
        withTimeoutThrow(delay(30, "job-3"), 500, "data job 3"),
      ]);

      assertEquals(results, ["job-1", "job-2", "job-3"]);
    });

    it("one timeout does not affect other parallel operations", async () => {
      const results = await Promise.allSettled([
        withTimeoutThrow(delay(10, "fast"), 500, "fast job"),
        withTimeoutThrow(hang(), 50, "slow job"),
        withTimeoutThrow(delay(10, "also-fast"), 500, "also-fast job"),
      ]);

      assertEquals(results[0]?.status, "fulfilled");
      assertEquals(results[1]?.status, "rejected");
      assertEquals(results[2]?.status, "fulfilled");
    });
  });
});
