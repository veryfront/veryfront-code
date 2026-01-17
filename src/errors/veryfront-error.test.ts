import { assert, assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
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
  type VeryfrontError,
} from "./veryfront-error.ts";

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
      const error: VeryfrontError = { type: "build", message: "test" };
      assertEquals(isBuildError(error), true);
      assertEquals(isAPIError(error), false);
    });

    it("should detect API errors", () => {
      const error: VeryfrontError = { type: "api", message: "test" };
      assertEquals(isAPIError(error), true);
      assertEquals(isBuildError(error), false);
    });

    it("should detect render errors", () => {
      const error: VeryfrontError = { type: "render", message: "test" };
      assertEquals(isRenderError(error), true);
    });

    it("should detect config errors", () => {
      const error: VeryfrontError = { type: "config", message: "test" };
      assertEquals(isConfigError(error), true);
    });

    it("should detect file errors", () => {
      const error: VeryfrontError = { type: "file", message: "test" };
      assertEquals(isFileError(error), true);
    });

    it("should detect network errors", () => {
      const error: VeryfrontError = { type: "network", message: "test" };
      assertEquals(isNetworkError(error), true);
    });
  });

  describe("toError", () => {
    it("should convert VeryfrontError to Error", () => {
      const veryfrontError: VeryfrontError = {
        type: "build",
        message: "Build failed",
      };
      const error = toError(veryfrontError);

      assertEquals(error instanceof Error, true);
      assertEquals(error.message, "Build failed");
      assertEquals(error.name, "VeryfrontError[build]");
    });

    it("should attach context to error", () => {
      const veryfrontError: VeryfrontError = {
        type: "api",
        message: "Request failed",
        context: { endpoint: "/test" },
      };
      const error = toError(veryfrontError);

      // Context is attached but not enumerable
      assertEquals((error as unknown as { context: VeryfrontError }).context, veryfrontError);
    });
  });

  describe("fromError", () => {
    it("should extract VeryfrontError from Error", () => {
      const veryfrontError: VeryfrontError = {
        type: "build",
        message: "Build failed",
      };
      const error = toError(veryfrontError);
      const extracted = fromError(error);

      assertEquals(extracted, veryfrontError);
    });

    it("should return null for regular errors", () => {
      const error = new Error("Regular error");
      const extracted = fromError(error);
      assertEquals(extracted, null);
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
  });

  describe("getErrorMessage", () => {
    it("should extract message from Error", () => {
      const error = new Error("Test error message");
      assertEquals(getErrorMessage(error), "Test error message");
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
  });

  describe("ensureError", () => {
    it("should return Error instances unchanged", () => {
      const error = new Error("Original error");
      const result = ensureError(error);
      assertEquals(result, error);
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
      // Use reference comparison - each call should create a new Error instance
      assert(result1 !== result2, "Expected different Error instances");
    });
  });
});
