import "#veryfront/schemas/_test-setup.ts";
import { describe, it } from "#veryfront/testing/bdd";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert";
import {
  handleErrorWithFallback,
  handleErrorWithFallbackSync,
  retryWithBackoff,
} from "./error-handlers.ts";

describe("error-handlers", () => {
  describe("handleErrorWithFallback", () => {
    it("rejects programming errors before invoking the operation", async () => {
      let invoked = false;
      await assertRejects(
        () =>
          handleErrorWithFallback(
            (() => {
              invoked = true;
              return "success";
            }) as () => string,
            "fallback",
            null as never,
          ),
        TypeError,
      );
      assertEquals(invoked, false);
      await assertRejects(
        () => handleErrorWithFallback(null as never, "fallback"),
        TypeError,
      );
    });

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

    it("does not pass raw failures to the logger", async () => {
      const calls: unknown[][] = [];
      const logger = { warn: (...args: unknown[]) => calls.push(args) };

      await handleErrorWithFallback(
        () => Promise.reject(new Error("password=<TOKEN> at /private/project/file.ts")),
        "fallback",
        logger,
      );

      assertEquals(calls.length, 1);
      assertEquals(JSON.stringify(calls).includes("<TOKEN>"), false);
      assertEquals(JSON.stringify(calls).includes("/private/project"), false);
    });
  });

  describe("handleErrorWithFallbackSync", () => {
    it("rejects an invalid operation instead of hiding it with the fallback", () => {
      assertThrows(
        () => handleErrorWithFallbackSync(null as never, "fallback"),
        TypeError,
      );
    });

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
        { maxRetries: 3, initialDelay: 1 },
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
            { maxRetries: 2, initialDelay: 1 },
          ),
        Error,
        "always fails",
      );

      assertEquals(attempts, 2);
    });

    it("rejects invalid retry budgets before invoking the operation", () => {
      let attempts = 0;
      for (
        const options of [
          { maxRetries: 0 },
          { maxRetries: 1.5 },
          { initialDelay: -1 },
          { maxDelay: Number.POSITIVE_INFINITY },
          { initialDelay: 10, maxDelay: 5 },
          { signal: {} as AbortSignal },
        ]
      ) {
        assertThrows(
          () => retryWithBackoff(async () => String(++attempts), options),
          TypeError,
        );
      }
      assertEquals(attempts, 0);
    });

    it("stops promptly when the retry signal is aborted", async () => {
      const controller = new AbortController();
      let attempts = 0;
      const result = retryWithBackoff(
        async () => {
          attempts++;
          controller.abort(new Error("cancelled"));
          throw new Error("retryable");
        },
        {
          maxRetries: 3,
          initialDelay: 10_000,
          maxDelay: 10_000,
          signal: controller.signal,
        },
      );

      await assertRejects(() => result, Error, "cancelled");
      assertEquals(attempts, 1);
    });

    it("snapshots the logger callback before asynchronous work", async () => {
      const messages: string[] = [];
      const logger = { warn: (message: string) => messages.push(message) };
      let attempts = 0;
      const result = await retryWithBackoff(
        async () => {
          attempts++;
          if (attempts === 1) {
            logger.warn = () => {
              throw new Error("mutated logger");
            };
            throw new Error("retry");
          }
          return "success";
        },
        { maxRetries: 2, initialDelay: 0, logger },
      );

      assertEquals(result, "success");
      assertEquals(messages, ["Attempt 1 failed, retrying"]);
    });
  });
});
