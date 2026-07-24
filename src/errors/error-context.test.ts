import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { serverLogger } from "#veryfront/utils/logger/logger.ts";
import {
  createErrorScope,
  safeReadDir,
  withErrorContext,
  withErrorContextSync,
} from "./error-context.ts";

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
        () => Promise.reject(new Error("test")),
        { operation: "test" },
        { fallback: { data: [] } },
      );
      assertEquals(result, { data: [] });
    });

    it("should fail closed for hostile runtime operation values", async () => {
      let coercions = 0;
      const hostileOperation = {
        [Symbol.toPrimitive](): never {
          coercions++;
          throw new Error("blocked");
        },
      } as unknown as string;

      const result = await withErrorContext(
        () => Promise.reject(new Error("operation failed")),
        { operation: hostileOperation },
        { fallback: "fallback" },
      );

      assertEquals(result, "fallback");
      assertEquals(coercions, 0);
    });

    it("should preserve the fallback when the error log sink throws", async () => {
      const resultPromise = (() => {
        const originalLogError = serverLogger.error;
        serverLogger.error = () => {
          throw new Error("log sink failed");
        };

        try {
          return withErrorContext(
            () => {
              throw new Error("operation failed");
            },
            { operation: "test" },
            { fallback: "fallback", logLevel: "error" },
          );
        } finally {
          serverLogger.error = originalLogError;
        }
      })();

      assertEquals(await resultPromise, "fallback");
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

    it("should fail closed for hostile runtime operation values", () => {
      let coercions = 0;
      const hostileOperation = {
        [Symbol.toPrimitive](): never {
          coercions++;
          throw new Error("blocked");
        },
      } as unknown as string;

      const result = withErrorContextSync(
        () => {
          throw new Error("operation failed");
        },
        { operation: hostileOperation },
        { fallback: "fallback" },
      );

      assertEquals(result, "fallback");
      assertEquals(coercions, 0);
    });

    it("should preserve the fallback when the error log sink throws", () => {
      const originalLogError = serverLogger.error;
      serverLogger.error = () => {
        throw new Error("log sink failed");
      };

      try {
        const result = withErrorContextSync(
          () => {
            throw new Error("operation failed");
          },
          { operation: "test" },
          { fallback: "fallback", logLevel: "error" },
        );

        assertEquals(result, "fallback");
      } finally {
        serverLogger.error = originalLogError;
      }
    });
  });

  describe("safeReadDir", () => {
    it("should return an empty list when both iteration and debug logging fail", async () => {
      const resultPromise = (() => {
        const originalLogDebug = serverLogger.debug;
        serverLogger.debug = () => {
          throw new Error("log sink failed");
        };

        try {
          return safeReadDir(
            {
              fs: {
                readDir(): AsyncIterable<string> {
                  throw new Error("directory iteration failed");
                },
              },
            },
            "/project",
            "read-directory",
          );
        } finally {
          serverLogger.debug = originalLogDebug;
        }
      })();

      assertEquals(await resultPromise, []);
    });
  });

  describe("createErrorScope", () => {
    it("should create a scoped error handler", async () => {
      const scope = createErrorScope("TestScope");
      const result = await scope.run(() => Promise.resolve("success"), {}, "fallback");
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

      const result1 = await scope.run(
        () => Promise.reject(new Error("error level")),
        {},
        "fallback",
        "error",
      );
      assertEquals(result1, "fallback");

      const result2 = await scope.run(
        () => Promise.reject(new Error("warn level")),
        {},
        "fallback",
        "warn",
      );
      assertEquals(result2, "fallback");
    });

    it("should preserve the fallback when scoped context getters throw", async () => {
      const scope = createErrorScope("SafeScope");
      const details = Object.defineProperty({}, "path", {
        enumerable: true,
        get(): never {
          throw new Error("blocked");
        },
      }) as Parameters<typeof scope.run>[1];

      const result = await scope.run(
        () => Promise.reject(new Error("operation failed")),
        details,
        "fallback",
      );

      assertEquals(result, "fallback");
    });
  });
});
