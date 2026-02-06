import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { delay } from "#std/async.ts";
import {
  createAdapterFallback,
  createAdapterFallbackSync,
  FALLBACK_EXHAUSTED,
  withFallback,
  withFallbackSync,
} from "./fallback-wrapper.ts";
import { VeryfrontError } from "#veryfront/errors/types.ts";

describe("fallback-wrapper", () => {
  describe("withFallback", () => {
    it("should return primary result when successful", async () => {
      const primary = () => Promise.resolve("primary-success");
      const fallback = () => Promise.resolve("fallback-success");

      const result = await withFallback(primary, fallback, {
        operationName: "test-operation",
      });

      assertEquals(result, "primary-success");
    });

    it("should return fallback result when primary fails", async () => {
      const primary = () => Promise.reject(new Error("primary-error"));
      const fallback = () => Promise.resolve("fallback-success");

      const result = await withFallback(primary, fallback, {
        operationName: "test-operation",
        logError: false,
      });

      assertEquals(result, "fallback-success");
    });

    it("should throw VeryfrontError with fallback-exhausted slug when both fail", async () => {
      const primaryError = new Error("primary-error");
      const fallbackError = new Error("fallback-error");

      const primary = () => Promise.reject(primaryError);
      const fallback = () => Promise.reject(fallbackError);

      await assertRejects(
        () =>
          withFallback(primary, fallback, {
            operationName: "test-operation",
            logError: false,
          }),
        VeryfrontError,
        "Both primary and fallback operations failed for test-operation",
      );
    });

    it("should throw fallback error when rethrowOnFallbackFailure is false", async () => {
      const primaryError = new Error("primary-error");
      const fallbackError = new Error("fallback-error");

      const primary = () => Promise.reject(primaryError);
      const fallback = () => Promise.reject(fallbackError);

      await assertRejects(
        () =>
          withFallback(primary, fallback, {
            operationName: "test-operation",
            logError: false,
            rethrowOnFallbackFailure: false,
          }),
        Error,
        "fallback-error",
      );
    });

    it("should preserve error context in fallback-exhausted error", async () => {
      const primaryError = new Error("primary-error");
      const fallbackError = new Error("fallback-error");

      const primary = () => Promise.reject(primaryError);
      const fallback = () => Promise.reject(fallbackError);

      try {
        await withFallback(primary, fallback, {
          operationName: "test-operation",
          logError: false,
        });
        throw new Error("Should have thrown");
      } catch (error) {
        if (!(error instanceof VeryfrontError && error.slug === "fallback-exhausted")) throw error;
        const ctx = error.context as { primaryError: unknown; fallbackError: unknown };
        assertEquals(ctx.primaryError, primaryError);
        assertEquals(ctx.fallbackError, fallbackError);
        assertEquals(error.cause, primaryError);
      }
    });

    it("should handle async operations correctly", async () => {
      let primaryCalled = false;
      let fallbackCalled = false;

      const primary = async () => {
        primaryCalled = true;
        await delay(10);
        throw new Error("primary-error");
      };

      const fallback = async () => {
        fallbackCalled = true;
        await delay(10);
        return "fallback-success";
      };

      const result = await withFallback(primary, fallback, {
        operationName: "test-operation",
        logError: false,
      });

      assertEquals(primaryCalled, true);
      assertEquals(fallbackCalled, true);
      assertEquals(result, "fallback-success");
    });
  });

  describe("withFallbackSync", () => {
    it("should return primary result when successful", () => {
      const primary = () => "primary-success";
      const fallback = () => "fallback-success";

      const result = withFallbackSync(primary, fallback, {
        operationName: "test-operation",
      });

      assertEquals(result, "primary-success");
    });

    it("should return fallback result when primary fails", () => {
      const primary = () => {
        throw new Error("primary-error");
      };
      const fallback = () => "fallback-success";

      const result = withFallbackSync(primary, fallback, {
        operationName: "test-operation",
        logError: false,
      });

      assertEquals(result, "fallback-success");
    });

    it("should throw VeryfrontError with fallback-exhausted slug when both fail", () => {
      const primaryError = new Error("primary-error");
      const fallbackError = new Error("fallback-error");

      const primary = () => {
        throw primaryError;
      };
      const fallback = () => {
        throw fallbackError;
      };

      try {
        withFallbackSync(primary, fallback, {
          operationName: "test-operation",
          logError: false,
        });
        throw new Error("Should have thrown");
      } catch (error) {
        if (!(error instanceof VeryfrontError && error.slug === "fallback-exhausted")) throw error;
        assertEquals(
          error.message,
          "Both primary and fallback operations failed for test-operation",
        );
      }
    });

    it("should throw fallback error when rethrowOnFallbackFailure is false", () => {
      const primaryError = new Error("primary-error");
      const fallbackError = new Error("fallback-error");

      const primary = () => {
        throw primaryError;
      };
      const fallback = () => {
        throw fallbackError;
      };

      try {
        withFallbackSync(primary, fallback, {
          operationName: "test-operation",
          logError: false,
          rethrowOnFallbackFailure: false,
        });
        throw new Error("Should have thrown");
      } catch (error) {
        if (!(error instanceof Error)) throw error;
        assertEquals(error.message, "fallback-error");
      }
    });
  });

  describe("createAdapterFallback", () => {
    it("should create a reusable fallback wrapper", async () => {
      const adapterOperation = () => Promise.resolve("adapter-result");
      const directOperation = () => Promise.resolve("direct-result");

      const wrapper = createAdapterFallback(
        adapterOperation,
        directOperation,
        "test-operation",
      );

      const result = await wrapper.execute();
      assertEquals(result, "adapter-result");
    });

    it("should fall back to direct operation when adapter fails", async () => {
      const adapterOperation = () => Promise.reject(new Error("adapter-error"));
      const directOperation = () => Promise.resolve("direct-result");

      const wrapper = createAdapterFallback(
        adapterOperation,
        directOperation,
        "test-operation",
        { logError: false },
      );

      const result = await wrapper.execute();
      assertEquals(result, "direct-result");
    });

    it("should allow multiple executions", async () => {
      let callCount = 0;

      const adapterOperation = () => {
        callCount++;
        if (callCount === 1) return Promise.reject(new Error("adapter-error"));
        return Promise.resolve("adapter-result");
      };

      const directOperation = () => Promise.resolve("direct-result");

      const wrapper = createAdapterFallback(
        adapterOperation,
        directOperation,
        "test-operation",
        { logError: false },
      );

      const result1 = await wrapper.execute();
      assertEquals(result1, "direct-result");

      const result2 = await wrapper.execute();
      assertEquals(result2, "adapter-result");
    });

    it("should pass options to withFallback", async () => {
      const adapterOperation = () => Promise.reject(new Error("adapter-error"));
      const directOperation = () => Promise.reject(new Error("direct-error"));

      const wrapper = createAdapterFallback(
        adapterOperation,
        directOperation,
        "test-operation",
        { logError: false, rethrowOnFallbackFailure: false },
      );

      await assertRejects(() => wrapper.execute(), Error, "direct-error");
    });
  });

  describe("createAdapterFallbackSync", () => {
    it("should create a reusable sync fallback wrapper", () => {
      const adapterOperation = () => "adapter-result";
      const directOperation = () => "direct-result";

      const wrapper = createAdapterFallbackSync(
        adapterOperation,
        directOperation,
        "test-operation",
      );

      const result = wrapper.executeSync!();
      assertEquals(result, "adapter-result");
    });

    it("should fall back to direct operation when adapter fails", () => {
      const adapterOperation = () => {
        throw new Error("adapter-error");
      };
      const directOperation = () => "direct-result";

      const wrapper = createAdapterFallbackSync(
        adapterOperation,
        directOperation,
        "test-operation",
        { logError: false },
      );

      const result = wrapper.executeSync!();
      assertEquals(result, "direct-result");
    });

    it("should allow multiple executions", () => {
      let callCount = 0;

      const adapterOperation = () => {
        callCount++;
        if (callCount === 1) throw new Error("adapter-error");
        return "adapter-result";
      };

      const directOperation = () => "direct-result";

      const wrapper = createAdapterFallbackSync(
        adapterOperation,
        directOperation,
        "test-operation",
        { logError: false },
      );

      const result1 = wrapper.executeSync!();
      assertEquals(result1, "direct-result");

      const result2 = wrapper.executeSync!();
      assertEquals(result2, "adapter-result");
    });
  });

  describe("real-world usage scenarios", () => {
    it("should handle file system operations", async () => {
      const adapterReadFile = () => Promise.resolve("file content from adapter");
      const directReadFile = () => Promise.resolve("file content from Deno");

      const wrapper = createAdapterFallback(
        adapterReadFile,
        directReadFile,
        "readFile",
      );

      const content = await wrapper.execute();
      assertEquals(content, "file content from adapter");
    });

    it("should handle environment variable access", () => {
      const adapterGetEnv = () => "adapter-value";
      const directGetEnv = () => "deno-value";

      const wrapper = createAdapterFallbackSync(
        adapterGetEnv,
        directGetEnv,
        "env.get",
      );

      const value = wrapper.executeSync!();
      assertEquals(value, "adapter-value");
    });

    it("should handle network requests", async () => {
      const adapterFetch = () => Promise.resolve(new Response("adapter response"));
      const directFetch = () => Promise.resolve(new Response("direct response"));

      const wrapper = createAdapterFallback(adapterFetch, directFetch, "fetch");

      const response = await wrapper.execute();
      assertEquals(await response.text(), "adapter response");
    });
  });

  describe("FALLBACK_EXHAUSTED", () => {
    it("should create error with slug and context", () => {
      const primaryError = new Error("primary");

      const error = FALLBACK_EXHAUSTED.create({
        detail: "Both failed",
        cause: primaryError,
        context: { primaryError, fallbackError: new Error("fallback") },
      });

      assertEquals(error.slug, "fallback-exhausted");
      assertEquals(error.message, "Both failed");
      assertEquals(error.cause, primaryError);
      const ctx = error.context as { primaryError: unknown; fallbackError: unknown };
      assertEquals(ctx.primaryError, primaryError);
    });

    it("should work without cause", () => {
      const error = FALLBACK_EXHAUSTED.create({ detail: "Primary failed" });

      assertEquals(error.slug, "fallback-exhausted");
      assertEquals(error.cause, undefined);
    });
  });
});
