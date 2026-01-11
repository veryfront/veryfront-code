import { assertEquals } from "jsr:@std/assert@1";
import { describe, it } from "jsr:@std/testing@1/bdd";
import { createErrorScope, withErrorContext, withErrorContextSync } from "./error-context.ts";

describe("error-context", () => {
  describe("withErrorContext", () => {
    it("should return result on success", async () => {
      const result = await withErrorContext(
        () => Promise.resolve("success"),
        { operation: "test" },
        { fallback: "fallback" },
      );
      assertEquals(result, "success");
    });

    it("should return fallback on error", async () => {
      const result = await withErrorContext(
        () => Promise.reject(new Error("test error")),
        { operation: "test" },
        { fallback: "fallback" },
      );
      assertEquals(result, "fallback");
    });

    it("should handle null fallback", async () => {
      const result = await withErrorContext(
        () => Promise.reject(new Error("test error")),
        { operation: "test" },
        { fallback: null },
      );
      assertEquals(result, null);
    });

    it("should handle complex return types", async () => {
      const result = await withErrorContext(
        () => Promise.resolve({ data: [1, 2, 3] }),
        { operation: "test" },
        { fallback: { data: [] } },
      );
      assertEquals(result, { data: [1, 2, 3] });
    });

    it("should use fallback for complex types on error", async () => {
      const result = await withErrorContext(
        (): Promise<{ data: number[] }> => Promise.reject(new Error("test")),
        { operation: "test" },
        { fallback: { data: [] } },
      );
      assertEquals(result, { data: [] });
    });
  });

  describe("withErrorContextSync", () => {
    it("should return result on success", () => {
      const result = withErrorContextSync(
        () => "success",
        { operation: "test" },
        { fallback: "fallback" },
      );
      assertEquals(result, "success");
    });

    it("should return fallback on error", () => {
      const result = withErrorContextSync(
        () => {
          throw new Error("test error");
        },
        { operation: "test" },
        { fallback: "fallback" },
      );
      assertEquals(result, "fallback");
    });

    it("should handle number fallback", () => {
      const result = withErrorContextSync(
        () => {
          throw new Error("test");
        },
        { operation: "test" },
        { fallback: 0 },
      );
      assertEquals(result, 0);
    });

    it("should handle array fallback", () => {
      const result = withErrorContextSync(
        () => {
          throw new Error("test");
        },
        { operation: "test" },
        { fallback: [] as string[] },
      );
      assertEquals(result, []);
    });
  });

  describe("createErrorScope", () => {
    it("should create a scoped error handler", async () => {
      const scope = createErrorScope("TestScope");
      const result = await scope.run(
        () => Promise.resolve("success"),
        {},
        "fallback",
      );
      assertEquals(result, "success");
    });

    it("should use fallback on error in scoped handler", async () => {
      const scope = createErrorScope("TestScope");
      const result = await scope.run(
        () => Promise.reject(new Error("scoped error")),
        {},
        "fallback",
      );
      assertEquals(result, "fallback");
    });

    it("should handle runSync operations", () => {
      const scope = createErrorScope("TestScope");
      const result = scope.runSync(() => "sync success", {}, "fallback");
      assertEquals(result, "sync success");
    });

    it("should handle runSync errors", () => {
      const scope = createErrorScope("TestScope");
      const result = scope.runSync(
        () => {
          throw new Error("sync error");
        },
        {},
        "sync fallback",
      );
      assertEquals(result, "sync fallback");
    });

    it("should pass details to context", async () => {
      const scope = createErrorScope("FileOps");
      const result = await scope.run(
        () => Promise.resolve("data"),
        { path: "/test/path", slug: "test-slug" },
        null,
      );
      assertEquals(result, "data");
    });

    it("should handle different log levels", async () => {
      const scope = createErrorScope("TestScope");

      // Test with error log level
      const result1 = await scope.run(
        () => Promise.reject(new Error("error level")),
        {},
        "fallback",
        "error",
      );
      assertEquals(result1, "fallback");

      // Test with warn log level
      const result2 = await scope.run(
        () => Promise.reject(new Error("warn level")),
        {},
        "fallback",
        "warn",
      );
      assertEquals(result2, "fallback");
    });
  });
});
