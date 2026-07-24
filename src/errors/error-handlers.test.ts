import "#veryfront/schemas/_test-setup.ts";
import { describe, it } from "#veryfront/testing/bdd";
import { assertEquals, assertRejects } from "#veryfront/testing/assert";
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
  });
});
