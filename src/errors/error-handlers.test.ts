import "#veryfront/schemas/_test-setup.ts";
import { describe, it } from "#veryfront/testing/bdd";
import { assertEquals, assertRejects } from "#veryfront/testing/assert";
import { MAX_TIMER_DELAY_MS } from "#veryfront/utils/timer.ts";
import {
  handleErrorWithFallback,
  handleErrorWithFallbackSync,
  retryWithBackoff,
} from "./error-handlers.ts";

describe("error-handlers", () => {
  describe("handleErrorWithFallback", () => {
    it("should return function result on success", async () => {
      const result = await handleErrorWithFallback(() => "success", "fallback");
      assertEquals(result, "success");
    });

    it("should return fallback on error", async () => {
      const result = await handleErrorWithFallback(() => {
        throw new Error("fail");
      }, "fallback");
      assertEquals(result, "fallback");
    });

    it("should handle async functions", async () => {
      const result = await handleErrorWithFallback(async () => {
        await Promise.resolve();
        return "async success";
      }, "fallback");
      assertEquals(result, "async success");
    });

    it("should return fallback on async error", async () => {
      const result = await handleErrorWithFallback(async () => {
        await Promise.resolve();
        throw new Error("async fail");
      }, "fallback");
      assertEquals(result, "fallback");
    });
  });

  describe("handleErrorWithFallbackSync", () => {
    it("should return function result on success", () => {
      const result = handleErrorWithFallbackSync(() => "success", "fallback");
      assertEquals(result, "success");
    });

    it("should return fallback on error", () => {
      const result = handleErrorWithFallbackSync(() => {
        throw new Error("fail");
      }, "fallback");
      assertEquals(result, "fallback");
    });
  });

  describe("retryWithBackoff", () => {
    it("should return result on first success", async () => {
      let attempts = 0;

      const result = await retryWithBackoff(async () => {
        await Promise.resolve();
        attempts++;
        return "success";
      });

      assertEquals(result, "success");
      assertEquals(attempts, 1);
    });

    it("should retry on failure and succeed", async () => {
      let attempts = 0;

      const result = await retryWithBackoff(
        async () => {
          await Promise.resolve();
          attempts++;
          if (attempts < 2) throw new Error("fail");
          return "success";
        },
        { maxAttempts: 3, initialDelay: 1 },
      );

      assertEquals(result, "success");
      assertEquals(attempts, 2);
    });

    it("should throw after max retries", async () => {
      let attempts = 0;

      await assertRejects(
        () =>
          retryWithBackoff(
            async () => {
              await Promise.resolve();
              attempts++;
              throw new Error("always fails");
            },
            { maxAttempts: 2, initialDelay: 1 },
          ),
        Error,
        "always fails",
      );

      assertEquals(attempts, 2);
    });

    it("should reject invalid maxAttempts with a RangeError", async () => {
      await assertRejects(
        () => retryWithBackoff(() => Promise.resolve("never"), { maxAttempts: 0 }),
        RangeError,
        "maxAttempts",
      );
    });

    it("should reject invalid retry timing options", async () => {
      for (
        const options of [
          { initialDelay: -1 },
          { initialDelay: Number.NaN },
          { maxDelay: Number.POSITIVE_INFINITY },
          { timeoutMs: -1 },
          { initialDelay: MAX_TIMER_DELAY_MS + 1 },
          { maxDelay: MAX_TIMER_DELAY_MS + 1 },
          { timeoutMs: MAX_TIMER_DELAY_MS + 1 },
        ]
      ) {
        await assertRejects(
          () => retryWithBackoff(() => Promise.resolve("never"), options),
          RangeError,
        );
      }
    });

    it("should reject invalid custom delays before sleeping", async () => {
      for (const delay of [Number.NaN, MAX_TIMER_DELAY_MS + 1]) {
        await assertRejects(
          () =>
            retryWithBackoff(
              async () => {
                await Promise.resolve();
                throw new Error("retry");
              },
              {
                maxAttempts: 2,
                computeDelay: () => delay,
              },
            ),
          RangeError,
          "computeDelay",
        );
      }
    });

    it("should normalize fractional custom delays before hooks and sleeping", async () => {
      let attempts = 0;
      const observedDelays: number[] = [];

      const result = await retryWithBackoff(async () => {
        attempts++;
        if (attempts === 1) throw new Error("retry");
        return "ok";
      }, {
        maxAttempts: 2,
        computeDelay: () => 0.25,
        onRetry: ({ delay }) => observedDelays.push(delay),
      });

      assertEquals(result, "ok");
      assertEquals(observedDelays, [1]);
    });

    it("should clear an attempt timer before running retry hooks and backoff", async () => {
      let attempts = 0;
      let firstSignal: AbortSignal | undefined;

      const result = await retryWithBackoff(async (signal) => {
        attempts++;
        if (attempts === 1) {
          firstSignal = signal;
          throw new Error("retry");
        }
        return "ok";
      }, {
        maxAttempts: 2,
        timeoutMs: 5,
        computeDelay: () => 15,
        onRetry: () => {
          assertEquals(firstSignal?.aborted, false);
        },
      });

      assertEquals(result, "ok");
      assertEquals(firstSignal?.aborted, false);
    });

    it("should detach stateful Error proxies before retry bookkeeping", async () => {
      let attempts = 0;
      let nameReads = 0;
      const hostile = new Proxy(new Error("retry"), {
        get(target, property, receiver): unknown {
          if (property === "name" && ++nameReads > 1) {
            throw new Error("second read blocked");
          }
          return Reflect.get(target, property, receiver);
        },
      });

      const result = await retryWithBackoff(async () => {
        attempts++;
        if (attempts === 1) throw hostile;
        return "ok";
      }, {
        maxAttempts: 2,
        computeDelay: () => 0,
        onRetry: ({ error, isTimeout }) => {
          assertEquals(error.name, "Error");
          assertEquals(error.name, "Error");
          assertEquals(isTimeout, false);
        },
      });

      assertEquals(result, "ok");
      assertEquals(nameReads, 1);
    });

    it("should rethrow the original error immediately when shouldRetry returns false", async () => {
      let attempts = 0;
      const original = new Error("fatal");

      const thrown = await assertRejects(() =>
        retryWithBackoff(async () => {
          await Promise.resolve();
          attempts++;
          throw original;
        }, { maxAttempts: 3, initialDelay: 1, shouldRetry: () => false })
      );

      assertEquals(thrown, original);
      assertEquals(attempts, 1);
    });

    it("should abort each attempt after timeoutMs and report isTimeout to onRetry", async () => {
      const retryErrorNames: string[] = [];
      const timeoutFlags: boolean[] = [];

      await assertRejects(() =>
        retryWithBackoff(
          (signal) =>
            new Promise<never>((_, reject) => {
              signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
            }),
          {
            maxAttempts: 2,
            initialDelay: 1,
            timeoutMs: 5,
            onRetry: ({ error, isTimeout }) => {
              retryErrorNames.push(error.name);
              timeoutFlags.push(isTimeout);
            },
          },
        )
      );

      assertEquals(retryErrorNames, ["AbortError"]);
      assertEquals(timeoutFlags, [true]);
    });

    it("should report its timer abort when the attempt translates the abort error", async () => {
      const retryErrorNames: string[] = [];
      const timeoutFlags: boolean[] = [];

      await assertRejects(() =>
        retryWithBackoff(
          (signal) =>
            new Promise<never>((_, reject) => {
              signal?.addEventListener(
                "abort",
                () => reject(new Error("transport translated the abort")),
                { once: true },
              );
            }),
          {
            maxAttempts: 2,
            initialDelay: 1,
            timeoutMs: 5,
            onRetry: ({ error, isTimeout }) => {
              retryErrorNames.push(error.name);
              timeoutFlags.push(isTimeout);
            },
          },
        )
      );

      assertEquals(retryErrorNames, ["Error"]);
      assertEquals(timeoutFlags, [true]);
    });

    it("should not report an independent AbortError as its own timeout", async () => {
      const timeoutFlags: boolean[] = [];
      let attempts = 0;

      const result = await retryWithBackoff(async () => {
        attempts++;
        if (attempts === 1) {
          throw new DOMException("independent cancellation", "AbortError");
        }
        return "ok";
      }, {
        maxAttempts: 2,
        computeDelay: () => 0,
        timeoutMs: 1_000,
        onRetry: ({ isTimeout }) => timeoutFlags.push(isTimeout),
      });

      assertEquals(result, "ok");
      assertEquals(timeoutFlags, [false]);
    });

    it("should use computeDelay with 0-based attempt and the thrown error", async () => {
      const observed: Array<[number, string]> = [];
      let attempts = 0;

      const result = await retryWithBackoff(async () => {
        await Promise.resolve();
        attempts++;
        if (attempts < 3) throw new Error(`fail ${attempts}`);
        return "ok";
      }, {
        maxAttempts: 3,
        computeDelay: (attempt, error) => {
          observed.push([attempt, (error as Error).message]);
          return 1;
        },
      });

      assertEquals(result, "ok");
      assertEquals(observed, [[0, "fail 1"], [1, "fail 2"]]);
    });

    it("should wrap the terminal error with wrapFinalError and pass the last attempt", async () => {
      const thrown = await assertRejects(() =>
        retryWithBackoff(async () => {
          await Promise.resolve();
          throw new Error("boom");
        }, {
          maxAttempts: 2,
          initialDelay: 1,
          wrapFinalError: (lastError, lastAttempt) =>
            new Error(`wrapped:${lastError.message}:${lastAttempt}`),
        })
      );

      assertEquals((thrown as Error).message, "wrapped:boom:1");
    });

    it("should give terminal wrappers a stable snapshot of stateful proxies", async () => {
      let nameReads = 0;
      const hostile = new Proxy(new Error("wrapped proxy"), {
        get(target, property, receiver): unknown {
          if (property === "name" && ++nameReads > 1) {
            throw new Error("second read blocked");
          }
          return Reflect.get(target, property, receiver);
        },
      });

      const thrown = await assertRejects(() =>
        retryWithBackoff(async () => {
          await Promise.resolve();
          throw hostile;
        }, {
          maxAttempts: 1,
          wrapFinalError: (lastError) => new Error(`wrapped:${lastError.name}:${lastError.name}`),
        })
      );

      assertEquals((thrown as Error).message, "wrapped:Error:Error");
      assertEquals(nameReads, 1);
    });

    it("should preserve terminal Error subclass and identity without a wrapper", async () => {
      class CustomError extends Error {
        readonly code = 42;
      }

      const original = new CustomError("custom failure");
      const thrown = await assertRejects(() =>
        retryWithBackoff(async () => {
          await Promise.resolve();
          throw original;
        }, { maxAttempts: 1 })
      );

      assertEquals(thrown, original);
      assertEquals(thrown instanceof CustomError, true);
      assertEquals((thrown as CustomError).code, 42);
    });
  });
});
