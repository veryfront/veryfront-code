import "#veryfront/schemas/_test-setup.ts";
import {
  assert,
  assertEquals,
  assertStrictEquals,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createError,
  ensureError,
  fromError,
  getErrorMessage,
  isAPIError,
  isBuildError,
  isConfigError,
  isFileError,
  isNetworkError,
  isRenderError,
  toError,
  type VeryfrontErrorData,
} from "./veryfront-error.ts";

describe("veryfront-error", () => {
  describe("createError", () => {
    it("validates runtime data while preserving valid object identity", () => {
      const data: VeryfrontErrorData = { type: "build", message: "Build failed" };

      assertStrictEquals(createError(data), data);
      assertThrows(
        () => createError({ type: "build", message: 42 } as never),
        TypeError,
        "Invalid Veryfront error data",
      );
    });

    it("should create a build error", () => {
      const error = createError({
        type: "build",
        message: "Build failed",
        context: { file: "test.ts", phase: "transform" },
      });

      assertEquals(error.type, "build");
      assertEquals(error.message, "Build failed");
    });

    it("should create an API error", () => {
      const error = createError({
        type: "api",
        message: "API request failed",
        context: { endpoint: "/users", statusCode: 500 },
      });

      assertEquals(error.type, "api");
      assertEquals(error.message, "API request failed");
    });

    it("should create a render error", () => {
      const error = createError({
        type: "render",
        message: "Render failed",
        context: { component: "App", phase: "server" },
      });

      assertEquals(error.type, "render");
    });

    it("should create a config error", () => {
      const error = createError({
        type: "config",
        message: "Invalid config",
        context: { field: "port", expected: "number" },
      });

      assertEquals(error.type, "config");
    });
  });

  describe("type guards", () => {
    it("should detect build errors", () => {
      const error: VeryfrontErrorData = { type: "build", message: "test" };
      assertEquals(isBuildError(error), true);
      assertEquals(isAPIError(error), false);
    });

    it("should detect API errors", () => {
      const error: VeryfrontErrorData = { type: "api", message: "test" };
      assertEquals(isAPIError(error), true);
      assertEquals(isBuildError(error), false);
    });

    it("should detect render errors", () => {
      const error: VeryfrontErrorData = { type: "render", message: "test" };
      assertEquals(isRenderError(error), true);
    });

    it("should detect config errors", () => {
      const error: VeryfrontErrorData = { type: "config", message: "test" };
      assertEquals(isConfigError(error), true);
    });

    it("should detect file errors", () => {
      const error: VeryfrontErrorData = { type: "file", message: "test" };
      assertEquals(isFileError(error), true);
    });

    it("should detect network errors", () => {
      const error: VeryfrontErrorData = { type: "network", message: "test" };
      assertEquals(isNetworkError(error), true);
    });
  });

  describe("toError", () => {
    it("rejects malformed data before creating a throwable error", () => {
      assertThrows(
        () => toError({ type: "build", message: 42 } as never),
        TypeError,
        "Invalid Veryfront error data",
      );
    });

    it("uses the validated message snapshot once", () => {
      let reads = 0;
      const data = {
        type: "build",
        get message() {
          reads++;
          return reads === 1 ? "Stable failure" : "password=<TOKEN>";
        },
      } as VeryfrontErrorData;

      const error = toError(data);

      assertEquals(error.message, "Stable failure");
      assertEquals(reads, 1);
    });

    it("should convert VeryfrontError to Error", () => {
      const veryfrontError: VeryfrontErrorData = {
        type: "build",
        message: "Build failed",
      };
      const error = toError(veryfrontError);

      assertEquals(error instanceof Error, true);
      assertEquals(error.message, "Build failed");
      assertEquals(error.name, "VeryfrontError[build]");
    });

    it("should attach context to error", () => {
      const veryfrontError: VeryfrontErrorData = {
        type: "api",
        message: "Request failed",
        context: { endpoint: "/test" },
      };
      const error = toError(veryfrontError);

      assertEquals((error as unknown as { context: VeryfrontErrorData }).context, veryfrontError);
    });
  });

  describe("fromError", () => {
    it("should extract VeryfrontError from Error", () => {
      const veryfrontError: VeryfrontErrorData = {
        type: "build",
        message: "Build failed",
      };
      const error = toError(veryfrontError);
      const extracted = fromError(error);

      assertEquals(extracted, veryfrontError);
    });

    it("should extract every valid error data variant", () => {
      const variants: VeryfrontErrorData[] = [
        {
          type: "build",
          message: "Build failed",
          context: {
            file: "main.ts",
            line: 1,
            column: 2,
            moduleId: "main",
            phase: "bundle",
            failures: 1,
            missing: [{ specifier: "./dep.ts", fromFile: "main.ts", reason: "missing" }],
            failed: ["./dep.ts"],
            cacheDir: ".cache",
          },
        },
        {
          type: "api",
          message: "Request failed",
          context: {
            endpoint: "/api/projects",
            method: "GET",
            statusCode: 500,
            headers: { accept: "application/json" },
          },
        },
        {
          type: "render",
          message: "Render failed",
          context: { component: "App", route: "/", phase: "server", props: { slug: "home" } },
        },
        {
          type: "config",
          message: "Config failed",
          context: {
            configFile: "veryfront.config.ts",
            field: "port",
            value: 0,
            expected: "number",
          },
        },
        {
          type: "agent",
          message: "Agent failed",
          context: { agentId: "agent", intent: "run", timeout: 100 },
        },
        {
          type: "file",
          message: "Read failed",
          context: { path: "file.ts", operation: "read", permissions: "read" },
        },
        {
          type: "network",
          message: "Fetch failed",
          context: { url: "https://example.com", timeout: 100, retryCount: 1 },
        },
        { type: "permission", message: "Denied", context: { path: "file.ts", operation: "write" } },
        { type: "not_supported", message: "Unsupported", feature: "feature" },
        { type: "no_ai_available", message: "AI unavailable" },
      ];

      for (const context of variants) {
        assertEquals(fromError({ context }), context);
      }
    });

    it("should return null for regular errors", () => {
      assertEquals(fromError(new Error("Regular error")), null);
    });

    it("should return null for non-error values", () => {
      assertEquals(fromError("string error"), null);
      assertEquals(fromError(null), null);
      assertEquals(fromError(undefined), null);
      assertEquals(fromError(42), null);
    });

    it("should return null for objects without proper context", () => {
      assertEquals(fromError({ context: "not an error" }), null);
      assertEquals(fromError({ context: { notType: true } }), null);
    });

    it("should reject malformed error data", () => {
      const malformedContexts = [
        { type: "build", message: 123 },
        { type: "unknown", message: "Unknown type" },
        { type: "build", message: "Build failed", context: { phase: "unknown" } },
        { type: "api", message: "Request failed", context: { statusCode: "500" } },
        {
          type: "build",
          message: "Resolution failed",
          context: { missing: [{ specifier: "./dep.ts", fromFile: "main.ts" }] },
        },
        { type: "not_supported", message: "Unsupported", feature: 42 },
        { type: "build", message: "Build failed", context: { line: Number.NaN } },
        { type: "network", message: "Network failed", context: { timeout: Infinity } },
      ];

      for (const context of malformedContexts) {
        assertEquals(fromError({ context }), null);
      }
    });

    it("should return the same context value that it validates", () => {
      const validContext: VeryfrontErrorData = { type: "build", message: "Build failed" };
      const malformedContext = { type: "build", message: 123 };
      let reads = 0;
      const error = {
        get context() {
          reads++;
          return reads === 1 ? validContext : malformedContext;
        },
      };

      assertEquals(fromError(error), validContext);
      assertEquals(reads, 1);
    });
  });

  describe("getErrorMessage", () => {
    it("should extract message from Error", () => {
      assertEquals(getErrorMessage(new Error("Test error message")), "Test error message");
    });

    it("should convert non-Error to string", () => {
      assertEquals(getErrorMessage("string error"), "string error");
      assertEquals(getErrorMessage(123), "123");
      assertEquals(getErrorMessage(null), "null");
      assertEquals(getErrorMessage(undefined), "undefined");
    });

    it("should handle objects", () => {
      const obj = { toString: () => "custom object" };
      assertEquals(getErrorMessage(obj), "custom object");
    });

    it("should return a stable message when string conversion throws", () => {
      const hostileValue = {
        [Symbol.toPrimitive]() {
          throw new Error("conversion failed");
        },
      };

      assertEquals(getErrorMessage(hostileValue), "Unknown error");
    });

    it("always returns a string when an Error message is mutated", () => {
      const error = new Error("original");
      Object.defineProperty(error, "message", { value: 42 });

      assertEquals(getErrorMessage(error), "42");
    });
  });

  describe("ensureError", () => {
    it("should return Error instances unchanged", () => {
      const error = new Error("Original error");
      assertEquals(ensureError(error), error);
    });

    it("should wrap strings in Error", () => {
      const result = ensureError("string error");
      assertEquals(result instanceof Error, true);
      assertEquals(result.message, "string error");
    });

    it("should wrap numbers in Error", () => {
      const result = ensureError(42);
      assertEquals(result instanceof Error, true);
      assertEquals(result.message, "42");
    });

    it("should wrap null/undefined in Error", () => {
      assertEquals(ensureError(null).message, "null");
      assertEquals(ensureError(undefined).message, "undefined");
    });

    it("should create new Error instance for non-Error values", () => {
      const result1 = ensureError("test");
      const result2 = ensureError("test");

      assert(result1 !== result2, "Expected different Error instances");
    });

    it("should return an Error when string conversion throws", () => {
      const hostileValue = {
        toString() {
          throw new Error("conversion failed");
        },
      };

      const result = ensureError(hostileValue);

      assertEquals(result instanceof Error, true);
      assertEquals(result.message, "Unknown error");
    });
  });
});
