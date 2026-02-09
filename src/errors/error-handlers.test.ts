import { describe, it } from "#veryfront/testing/bdd";
import { assertEquals, assertRejects } from "#veryfront/testing/assert";
import {
  handleErrorWithFallback,
  handleErrorWithFallbackSync,
  retryWithBackoff,
  wrapError,
} from "./error-handlers.ts";
import { VeryfrontError } from "./types.ts";

describe("error-handlers", () => {
  describe("wrapError", () => {
    it("should wrap a plain Error with message and context", () => {
      const original = new Error("Original error");
      const wrapped = wrapError(original, "Wrapper message", { key: "value" });

      assertEquals(wrapped.message, "Wrapper message: Original error");
      assertEquals(wrapped.slug, "unknown-error");
      assertEquals((wrapped.context as { key?: string } | undefined)?.key, "value");
    });

    it("should preserve slug from VeryfrontError", () => {
      const original = new VeryfrontError("Original", {
        slug: "build-failed",
        category: "BUILD",
        status: 500,
        title: "Build failed",
      });
      const wrapped = wrapError(original, "Wrapped");

      assertEquals(wrapped.slug, "build-failed");
    });

    it("should convert non-Error to Error", () => {
      const wrapped = wrapError("string error", "Wrapper");

      assertEquals(wrapped.message, "Wrapper: string error");
    });
  });

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
  });
});
