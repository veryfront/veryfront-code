import "#veryfront/schemas/_test-setup.ts";
/**
 * P1-5: Pipeline Timeout Enforcement Tests
 *
 * Spec: specs/rendering/ssr-orchestration.spec.md
 * Verifies: withTimeout (soft) and withTimeoutThrow (hard) behavior
 * at the three pipeline timeout stages.
 */
import { assertEquals, assertRejects } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { FakeTime } from "#std/testing/time";
import {
  TimeoutError,
  withProgressTimeoutThrow,
  withTimeout,
  withTimeoutThrow,
} from "./stream-utils.ts";

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

  describe("withProgressTimeoutThrow (bounded idle timeout)", () => {
    it("allows total work beyond the idle deadline while progress continues", async () => {
      using time = new FakeTime();
      let markStarted!: () => void;
      const started = new Promise<void>((resolve) => markStarted = resolve);
      const result = withProgressTimeoutThrow(
        async ({ mark }) => {
          markStarted();
          await delay(25, undefined);
          mark("first module transformed");
          await delay(25, undefined);
          mark("second module transformed");
          return await delay(10, "success");
        },
        { label: "module graph", idleTimeoutMs: 40, hardTimeoutMs: 200 },
      );
      await started;
      await time.tickAsync(25);
      await time.tickAsync(25);
      await time.tickAsync(10);

      assertEquals(await result, "success");
    });

    it("allows an outer deadline to bound progressing work without a local hard cap", async () => {
      using time = new FakeTime();
      let markStarted!: () => void;
      const started = new Promise<void>((resolve) => markStarted = resolve);
      const result = withProgressTimeoutThrow(
        async ({ mark }) => {
          markStarted();
          for (let index = 0; index < 6; index += 1) {
            await delay(15, undefined);
            mark(`module ${index} transformed`);
          }
          return "success";
        },
        { label: "large module graph", idleTimeoutMs: 25 },
      );
      await started;
      for (let index = 0; index < 6; index += 1) {
        await time.tickAsync(15);
      }

      assertEquals(await result, "success");
    });

    it("propagates a parent cancellation to cooperative work", async () => {
      using time = new FakeTime();
      const parent = new AbortController();
      let observedSignal: AbortSignal | undefined;
      let markStarted!: () => void;
      const started = new Promise<void>((resolve) => markStarted = resolve);
      const result = withProgressTimeoutThrow(
        ({ signal }) => {
          observedSignal = signal;
          markStarted();
          return hang();
        },
        {
          label: "cancelled module graph",
          idleTimeoutMs: 100,
          signal: parent.signal,
        },
      );
      const rejected = assertRejects(() => result, Error, "render cancelled");
      await started;

      parent.abort(new Error("render cancelled"));
      await time.tickAsync(100);

      await rejected;
      assertEquals(observedSignal?.aborted, true);
      assertEquals(observedSignal?.reason, parent.signal.reason);
    });

    it("does not start work after its parent was already cancelled", async () => {
      const parent = new AbortController();
      parent.abort(new Error("request already cancelled"));
      let started = false;

      await assertRejects(
        () =>
          withProgressTimeoutThrow(
            () => {
              started = true;
              return Promise.resolve("unexpected");
            },
            {
              label: "pre-cancelled module graph",
              idleTimeoutMs: 100,
              signal: parent.signal,
            },
          ),
        Error,
        "request already cancelled",
      );

      assertEquals(started, false);
    });

    it("throws an idle TimeoutError and aborts cooperative work without progress", async () => {
      let observedSignal: AbortSignal | undefined;
      const error = await assertRejects(
        () =>
          withProgressTimeoutThrow(
            ({ signal }) => {
              observedSignal = signal;
              return hang();
            },
            { label: "idle module graph", idleTimeoutMs: 30, hardTimeoutMs: 100 },
          ),
        TimeoutError,
        "idle module graph timed out after 30ms",
      );

      assertEquals((error as TimeoutError).timeoutKind, "idle");
      assertEquals(observedSignal?.aborted, true);
    });

    it("enforces the hard cap even while progress continues", async () => {
      const error = await assertRejects(
        () =>
          withProgressTimeoutThrow(
            ({ mark, signal }) =>
              new Promise<never>((_, reject) => {
                const intervalId = setInterval(() => mark("still transforming"), 10);
                signal.addEventListener(
                  "abort",
                  () => {
                    clearInterval(intervalId);
                    reject(signal.reason);
                  },
                  { once: true },
                );
              }),
            { label: "bounded module graph", idleTimeoutMs: 30, hardTimeoutMs: 75 },
          ),
        TimeoutError,
        "bounded module graph timed out after 75ms",
      );

      assertEquals((error as TimeoutError).timeoutKind, "hard");
      assertEquals((error as TimeoutError).lastProgress, "still transforming");
    });

    it("propagates an operation error before either deadline", async () => {
      await assertRejects(
        () =>
          withProgressTimeoutThrow(
            () => Promise.reject(new Error("transform failed")),
            { label: "failing module graph", idleTimeoutMs: 50, hardTimeoutMs: 100 },
          ),
        Error,
        "transform failed",
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
