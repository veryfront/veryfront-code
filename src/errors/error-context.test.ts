import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createErrorScope,
  safeFileRead,
  safeFileStat,
  safeReadDir,
  withErrorContext,
  withErrorContextSync,
} from "./error-context.ts";

describe("error-context", () => {
  describe("safe filesystem helpers", () => {
    it("rejects malformed adapters instead of hiding programming errors", async () => {
      await assertRejects(
        () => safeFileRead(null as never, "config.ts", "read config"),
        TypeError,
      );
      await assertRejects(
        () => safeFileStat({ fs: {} } as never, "config.ts", "stat config"),
        TypeError,
      );
      await assertRejects(
        () => safeReadDir({ fs: { readDir: 42 } } as never, ".", "read directory"),
        TypeError,
      );
    });

    it("returns the documented fallback only for filesystem operation failures", async () => {
      const adapter = {
        fs: {
          readFile: (_path: string) => Promise.reject(new Error("not found")),
          stat: (_path: string) => Promise.reject(new Error("not found")),
          readDir: (_path: string): AsyncIterable<string> => ({
            [Symbol.asyncIterator]() {
              return {
                next: () => Promise.reject(new Error("not found")),
              };
            },
          }),
        },
      };

      assertEquals(await safeFileRead(adapter, "missing.ts", "read file"), null);
      assertEquals(await safeFileStat(adapter, "missing.ts", "stat file"), null);
      assertEquals(await safeReadDir(adapter, ".", "read directory"), []);
    });
  });

  describe("withErrorContext", () => {
    it("rejects invalid operations and context before executing work", async () => {
      let invoked = false;
      await assertRejects(
        () =>
          withErrorContext(
            async () => {
              invoked = true;
              return "success";
            },
            { operation: "bad\noperation" },
            { fallback: "fallback" },
          ),
        TypeError,
      );
      assertEquals(invoked, false);
      await assertRejects(
        () => withErrorContext(null as never, { operation: "test" }, { fallback: "fallback" }),
        TypeError,
      );
    });

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

    it("does not emit failure text, stack paths, or sensitive details", async () => {
      const output: string[] = [];
      const originalConsoleError = console.error;
      console.error = (...args: unknown[]) => output.push(args.map(String).join(" "));
      try {
        const result = await withErrorContext(
          () =>
            Promise.reject(
              new Error("password=<TOKEN> at /private/project/config.ts"),
            ),
          {
            operation: "load config",
            path: "/private/project/config.ts",
            details: { payload: "customer data", apiKey: "<TOKEN>" },
          },
          {
            fallback: "fallback",
            includeStack: true,
            logLevel: "error",
          },
        );

        assertEquals(result, "fallback");
        const serialized = output.join("\n");
        assertEquals(serialized.includes("<TOKEN>"), false);
        assertEquals(serialized.includes("/private/project"), false);
        assertEquals(serialized.includes("customer data"), false);
      } finally {
        console.error = originalConsoleError;
      }
    });

    it("snapshots fallback options before asynchronous work starts", async () => {
      const options = { fallback: "stable", logLevel: "debug" as const };
      const result = await withErrorContext(
        async () => {
          options.fallback = "mutated";
          throw new Error("failed");
        },
        { operation: "test" },
        options,
      );

      assertEquals(result, "stable");
    });
  });

  describe("withErrorContextSync", () => {
    it("rejects an invalid operation instead of returning a fallback", () => {
      assertThrows(
        () =>
          withErrorContextSync(
            null as never,
            { operation: "test" },
            { fallback: "fallback" },
          ),
        TypeError,
      );
    });

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

    it("snapshots fallback options before synchronous work starts", () => {
      const options = { fallback: "stable", logLevel: "debug" as const };
      const result = withErrorContextSync(
        () => {
          options.fallback = "mutated";
          throw new Error("failed");
        },
        { operation: "test" },
        options,
      );

      assertEquals(result, "stable");
    });
  });

  describe("createErrorScope", () => {
    it("rejects malformed operation prefixes", () => {
      assertThrows(() => createErrorScope(""), TypeError);
      assertThrows(() => createErrorScope("x".repeat(257)), TypeError);
      assertThrows(() => createErrorScope(42 as never), TypeError);
    });

    it("rejects malformed scoped details before invoking work", async () => {
      const scope = createErrorScope("StableScope");
      let invoked = false;
      await assertRejects(
        () =>
          scope.run(
            async () => {
              invoked = true;
              return "success";
            },
            null as never,
            "fallback",
          ),
        TypeError,
      );
      assertEquals(invoked, false);
    });

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

    it("does not allow runtime details to replace the scoped operation", async () => {
      const output: string[] = [];
      const originalConsoleError = console.error;
      console.error = (...args: unknown[]) => output.push(args.map(String).join(" "));
      try {
        const scope = createErrorScope("StableScope");
        await scope.run(
          () => Promise.reject(new Error("failed")),
          { operation: "InjectedScope" } as never,
          "fallback",
          "error",
        );

        assertEquals(output.join("\n").includes("StableScope"), true);
        assertEquals(output.join("\n").includes("InjectedScope"), false);
      } finally {
        console.error = originalConsoleError;
      }
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
  });
});
