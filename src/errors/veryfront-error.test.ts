import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
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
  snapshotErrorAsError,
  toError,
  type VeryfrontErrorData,
} from "./veryfront-error.ts";
import { VeryfrontError } from "./types.ts";

describe("veryfront-error", () => {
  describe("createError", () => {
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
      assert(extracted !== veryfrontError, "Expected a defensive snapshot");
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

    it("should reject structurally invalid error data", () => {
      assertEquals(
        fromError({ context: { type: "forged", message: "Not a Veryfront error" } }),
        null,
      );
      assertEquals(fromError({ context: { type: "build", message: 42 } }), null);
    });

    it("should validate each discriminated variant before returning it", () => {
      const valid: VeryfrontErrorData[] = [
        {
          type: "build",
          message: "Build failed",
          context: {
            file: "main.ts",
            phase: "bundle",
            missing: [{
              specifier: "react",
              fromFile: "main.ts",
              reason: "not mapped",
            }],
            failed: ["https://example.com/module.ts"],
          },
        },
        {
          type: "api",
          message: "Request failed",
          context: { endpoint: "/users", method: "GET", statusCode: 503 },
        },
        {
          type: "render",
          message: "Render failed",
          context: { component: "App", phase: "server", props: { id: 1 } },
        },
        {
          type: "config",
          message: "Invalid config",
          context: { field: "port", value: "3000", expected: "number" },
        },
        {
          type: "agent",
          message: "Agent timed out",
          context: { agentId: "reviewer", timeout: 1_000 },
        },
        {
          type: "file",
          message: "Read failed",
          context: { path: "main.ts", operation: "read" },
        },
        {
          type: "network",
          message: "Fetch failed",
          context: { url: "https://example.com", retryCount: 2 },
        },
        {
          type: "permission",
          message: "Write denied",
          context: { path: "main.ts", operation: "write" },
        },
        {
          type: "not_supported",
          message: "Unavailable",
          feature: "legacy-build",
        },
        { type: "no_ai_available", message: "No provider configured" },
      ];

      for (const source of valid) {
        const extracted = fromError(toError(source));
        assertEquals(extracted, source);
        assert(extracted !== source, "Expected a defensive snapshot");
      }
    });

    it("should reject invalid variant fields and nested contexts", () => {
      const sparseFailed = new Array<string>(1);
      const invalid = [
        { type: "not_supported", message: "Unavailable", feature: 123 },
        {
          type: "build",
          message: "Build failed",
          context: { phase: "compile" },
        },
        {
          type: "build",
          message: "Build failed",
          context: {
            missing: [{
              specifier: "react",
              fromFile: "main.ts",
              reason: 404,
            }],
          },
        },
        {
          type: "build",
          message: "Build failed",
          context: { failed: sparseFailed },
        },
        {
          type: "api",
          message: "Request failed",
          context: { headers: { accept: 123 } },
        },
        {
          type: "render",
          message: "Render failed",
          context: { phase: "edge" },
        },
        {
          type: "file",
          message: "Copy failed",
          context: { operation: "copy" },
        },
        {
          type: "network",
          message: "Fetch failed",
          context: { timeout: Number.POSITIVE_INFINITY },
        },
      ];

      for (const context of invalid) {
        assertEquals(fromError({ context }), null);
      }
    });

    it("should fail closed when context access throws", () => {
      const error = Object.defineProperty({}, "context", {
        get(): never {
          throw new Error("unreadable");
        },
      });

      assertEquals(fromError(error), null);
    });

    it("should snapshot nested data without retaining mutable source references", () => {
      const source: VeryfrontErrorData = {
        type: "build",
        message: "Build failed",
        context: {
          missing: [{ specifier: "safe-package", fromFile: "main.ts", reason: "missing" }],
        },
      };
      const extracted = fromError(toError(source));
      assert(extracted?.type === "build");

      source.message = "mutated";
      source.context?.missing?.[0] && (source.context.missing[0].reason = "mutated");

      assertEquals(extracted.message, "Build failed");
      assertEquals(extracted.context?.missing?.[0]?.reason, "missing");
    });

    it("should reject accessor-backed nested context instead of executing it", () => {
      let reads = 0;
      const context = Object.defineProperty({}, "secret", {
        enumerable: true,
        get() {
          reads++;
          return "credential";
        },
      });

      assertEquals(fromError({ context: { type: "render", message: "failed", context } }), null);
      assertEquals(reads, 0);
    });

    it("should enforce the snapshot entry limit across nested containers", () => {
      const context = {
        type: "render",
        message: "failed",
        context: Array.from({ length: 101 }, () => new Array(100)),
      };

      assertEquals(fromError({ context }), null);
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

    it("should fail closed for values that throw during inspection", () => {
      const hostile = new Proxy({}, {
        getPrototypeOf(): never {
          throw new Error("blocked");
        },
        get(): never {
          throw new Error("blocked");
        },
      });

      assertEquals(getErrorMessage(hostile), "Unknown error");
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

    it("should wrap values that throw during inspection", () => {
      const hostile = new Proxy({}, {
        getPrototypeOf(): never {
          throw new Error("blocked");
        },
        get(): never {
          throw new Error("blocked");
        },
      });

      assertEquals(ensureError(hostile).message, "Unknown error");
    });

    it("should replace hostile proxies around real Error instances", () => {
      const hostile = new Proxy(new Error("secret"), {
        get(target, property, receiver): unknown {
          if (property === "message") throw new Error("blocked");
          return Reflect.get(target, property, receiver);
        },
      });

      const result = ensureError(hostile);

      assert(result !== hostile, "Expected a safe replacement error");
      assertEquals(result.message, "Unknown error");
    });
  });

  describe("snapshotErrorAsError", () => {
    it("should detach stateful proxies for repeated boundary reads", () => {
      let nameReads = 0;
      const hostile = new Proxy(new Error("retry"), {
        get(target, property, receiver): unknown {
          if (property === "name" && ++nameReads > 1) {
            throw new Error("second read blocked");
          }
          return Reflect.get(target, property, receiver);
        },
      });

      const result = snapshotErrorAsError(hostile);

      assert(result !== hostile, "Expected a detached Error");
      assertEquals(result.name, "Error");
      assertEquals(result.name, "Error");
      assertEquals(nameReads, 1);
    });

    it("should preserve safe own error metadata on the detached snapshot", () => {
      const source = Object.assign(new Error("network failed"), {
        code: "ECONNRESET",
      });

      const result = snapshotErrorAsError(source) as Error & { code?: string };

      assertEquals(result.code, "ECONNRESET");
    });

    it("should read stateful VeryfrontError fields only once", () => {
      let statusReads = 0;
      const source = new VeryfrontError("missing", {
        slug: "config-not-found",
        category: "CONFIG",
        status: 404,
        title: "Configuration file not found",
      });
      const stateful = new Proxy(source, {
        get(target, property, receiver): unknown {
          if (property === "status") {
            statusReads++;
            return statusReads === 1 ? 404 : 503;
          }
          return Reflect.get(target, property, receiver);
        },
      });

      const result = snapshotErrorAsError(stateful);

      assert(result instanceof VeryfrontError);
      assertEquals(result.status, 404);
      assertEquals(result.status, 404);
      assertEquals(statusReads, 1);
    });

    it("should not revisit an invalid VeryfrontError proxy as a native Error", () => {
      let messageReads = 0;
      const source = new VeryfrontError("hidden", {
        slug: "invalid",
        category: "GENERAL",
        status: 500,
        title: "Invalid",
      });
      const stateful = new Proxy(source, {
        get(target, property, receiver): unknown {
          if (property === "message") {
            messageReads++;
            return messageReads === 1 ? 42 : "second-read leak";
          }
          return Reflect.get(target, property, receiver);
        },
      });

      const result = snapshotErrorAsError(stateful);

      assertEquals(result.message, "Unknown error");
      assertEquals(messageReads, 1);
    });
  });
});
