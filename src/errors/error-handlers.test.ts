import "#veryfront/schemas/_test-setup.ts";
import { describe, it } from "#veryfront/testing/bdd";
import { assertEquals, assertInstanceOf, assertRejects } from "#veryfront/testing/assert";
import { ERROR_DIAGNOSTIC_MAX_LENGTH_CHARS } from "#veryfront/errors/diagnostic-policy.ts";
import { MAX_TIMER_DELAY_MS } from "#veryfront/utils/timer.ts";
import type { serverLogger } from "#veryfront/utils/logger/logger.ts";
import {
  handleErrorWithFallback,
  handleErrorWithFallbackSync,
  retryWithBackoff,
} from "./error-handlers.ts";

/**
 * Captures the warn calls made through the injectable `logger` parameter, which
 * exists only so a swallowed error still leaves a trace.
 */
function createWarnRecorder(): {
  logger: typeof serverLogger;
  warnings: unknown[][];
} {
  const warnings: unknown[][] = [];
  const logger = {
    warn: (...args: unknown[]) => {
      warnings.push(args);
    },
  } as unknown as typeof serverLogger;
  return { logger, warnings };
}

function assertSwallowedErrorIsLoggedAsDiagnostic(
  warnings: unknown[][],
  thrown: Error,
): void {
  assertEquals(warnings.length, 1, "the swallowed error must be logged once");
  const diagnostic = warnings[0]?.[1];
  assertInstanceOf(diagnostic, Error, "the warning must carry an Error diagnostic");
  assertEquals(diagnostic === thrown, false, "the warning must not retain the thrown Error");
  assertEquals(diagnostic.stack, undefined, "the warning diagnostic must not carry a stack");
  assertEquals(
    diagnostic.message.length <= ERROR_DIAGNOSTIC_MAX_LENGTH_CHARS,
    true,
    "the warning diagnostic must remain bounded",
  );
  assertEquals(
    diagnostic.message.includes("<TOKEN>"),
    false,
    "the warning diagnostic must redact credential values",
  );
}

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

    it("logs a bounded stackless diagnostic before returning the fallback", async () => {
      const { logger, warnings } = createWarnRecorder();
      const thrown = new Error(`https://example.test/?token=<TOKEN>${"x".repeat(3_000)}`);

      const result = await handleErrorWithFallback(
        () => {
          throw thrown;
        },
        "fallback",
        logger,
      );

      assertEquals(result, "fallback", "the fallback is still returned");
      assertSwallowedErrorIsLoggedAsDiagnostic(warnings, thrown);
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

    it("logs a bounded stackless diagnostic before returning the fallback", () => {
      const { logger, warnings } = createWarnRecorder();
      const thrown = new Error(`https://example.test/?token=<TOKEN>${"x".repeat(3_000)}`);

      const result = handleErrorWithFallbackSync(
        () => {
          throw thrown;
        },
        "fallback",
        logger,
      );

      assertEquals(result, "fallback", "the fallback is still returned");
      assertSwallowedErrorIsLoggedAsDiagnostic(warnings, thrown);
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

    it("should treat Error proxies as opaque during retry bookkeeping", async () => {
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
      assertEquals(nameReads, 0);
    });

    it("should not invoke conversion hooks while normalizing retry errors", async () => {
      let attempts = 0;
      let coercions = 0;
      const hostile = {
        [Symbol.toPrimitive](): never {
          coercions++;
          throw new Error("conversion hook must not run");
        },
      };

      const result = await retryWithBackoff(async () => {
        attempts++;
        if (attempts === 1) throw hostile;
        return "ok";
      }, {
        maxAttempts: 2,
        computeDelay: () => 0,
        onRetry: ({ error }) => assertEquals(error.message, "Unknown error"),
      });

      assertEquals(result, "ok");
      assertEquals(coercions, 0);
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

    it("should cancel a pending backoff without starting another attempt", async () => {
      const controller = new AbortController();
      let attempts = 0;
      let backoffStarted: (() => void) | undefined;
      const backoff = new Promise<void>((resolve) => {
        backoffStarted = resolve;
      });

      const pending = retryWithBackoff(async () => {
        attempts += 1;
        throw new Error("retry");
      }, {
        abortSignal: controller.signal,
        maxAttempts: 3,
        initialDelay: 60_000,
        maxDelay: 60_000,
        onRetry: () => backoffStarted?.(),
      });
      await backoff;
      controller.abort(new DOMException("cancelled", "AbortError"));

      const error = await assertRejects(() => pending);
      assertInstanceOf(error, DOMException);
      assertEquals(error.name, "AbortError");
      assertEquals(attempts, 1);
    });

    it("should not start an attempt for an already-aborted signal", async () => {
      const controller = new AbortController();
      controller.abort(new DOMException("cancelled", "AbortError"));
      let attempts = 0;

      const error = await assertRejects(
        () =>
          retryWithBackoff(async () => {
            await Promise.resolve();
            attempts += 1;
            return "unreachable";
          }, { abortSignal: controller.signal, maxAttempts: 3, initialDelay: 1 }),
        "an already-aborted signal must reject instead of resolving",
      );

      assertInstanceOf(
        error,
        DOMException,
        "the rejection must be the caller's own abort reason",
      );
      assertEquals(
        error.name,
        "AbortError",
        "an already-aborted signal must reject with the caller's abort reason",
      );
      assertEquals(attempts, 0, "no attempt may start once the caller has aborted");
    });

    it("should give each attempt a signal that observes the caller and the timeout", async () => {
      const controller = new AbortController();
      let attemptSignal: AbortSignal | undefined;

      const pending = retryWithBackoff((signal) => {
        attemptSignal = signal;
        return new Promise<never>((_, reject) => {
          signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
      }, {
        abortSignal: controller.signal,
        maxAttempts: 1,
        timeoutMs: 60_000,
      });

      controller.abort(new DOMException("cancelled", "AbortError"));

      assertEquals(
        attemptSignal?.aborted,
        true,
        "the caller's abort must reach the in-flight attempt even with a per-attempt timeout",
      );
      assertEquals(
        (attemptSignal?.reason as DOMException | undefined)?.message,
        "cancelled",
        "the attempt signal must carry the caller's abort reason, not the timeout's",
      );

      const error = await assertRejects(
        () => pending,
        "aborting the caller must reject the pending retry",
      );
      assertInstanceOf(
        error,
        DOMException,
        "the rejection must be the caller's own abort reason",
      );
      assertEquals(error.name, "AbortError", "the caller's abort reason is rethrown");
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

    it("uses the captured Error constructor for timeout reasons", async () => {
      const NativeError = Error;
      class ReplacementError extends NativeError {}
      // Swapping a global built-in stays in effect across the awaits below, and
      // the suite runs other tests in this isolate meanwhile. Assert only on the
      // value this call produced -- counting constructions process-wide would
      // also count every unrelated Error built inside the same window.
      globalThis.Error = ReplacementError as ErrorConstructor;

      try {
        const thrown = await assertRejects(() =>
          retryWithBackoff(
            (signal) =>
              new Promise<never>((_, reject) => {
                signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
              }),
            { maxAttempts: 1, timeoutMs: 1 },
          )
        );

        assertEquals(thrown instanceof ReplacementError, false);
        assertInstanceOf(thrown, NativeError);
        assertEquals(thrown.name, "AbortError");
      } finally {
        globalThis.Error = NativeError;
      }
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

    it("should give terminal wrappers an opaque snapshot of Error proxies", async () => {
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
      assertEquals(nameReads, 0);
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

    it("should detach a non-native throwable at the terminal throw", async () => {
      let nameReads = 0;
      const hostile = new Proxy(new Error("wrapped proxy"), {
        get(target, property, receiver): unknown {
          if (property === "name" && ++nameReads > 1) {
            throw new Error("second read blocked");
          }
          return Reflect.get(target, property, receiver);
        },
      });

      const thrown = await assertRejects(
        () =>
          retryWithBackoff(async () => {
            await Promise.resolve();
            throw hostile;
          }, { maxAttempts: 1 }),
        "the hostile throwable must surface as a rejection",
      );

      assertEquals(
        thrown === hostile,
        false,
        "a non-native throwable must not escape retryWithBackoff",
      );
      assertEquals((thrown as Error).name, "Error", "first name read");
      assertEquals(
        (thrown as Error).name,
        "Error",
        "a detached error stays readable on a second read",
      );
      assertEquals(nameReads, 0, "no project get trap runs at the boundary");
    });
  });
});
