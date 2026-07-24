import "#veryfront/schemas/_test-setup.ts";
/**
 * Tests for Error Wrapping Utilities
 */

import { describe, it } from "#veryfront/testing/bdd";
import { assertEquals, assertExists } from "#veryfront/testing/assert";
import { detachBoundaryError, wrapUnknownError, wrapWithContext } from "./wrap-unknown.ts";
import { isVeryfrontError } from "../http-error.ts";
import { VeryfrontError } from "../types.ts";
import { CONFIG_NOT_FOUND } from "../error-registry.ts";

function getContext(error: VeryfrontError): Record<string, unknown> {
  assertExists(error.context);
  return error.context as Record<string, unknown>;
}

describe("wrap-unknown", () => {
  describe("wrapUnknownError", () => {
    it("should wrap plain Error as unknown-error", () => {
      const error = new Error("Something went wrong");
      const wrapped = wrapUnknownError(error);

      assertEquals(wrapped instanceof VeryfrontError, true);
      assertEquals(wrapped.slug, "unknown-error");
      assertEquals(wrapped.category, "GENERAL");
      assertEquals(wrapped.detail, "Something went wrong");
      assertEquals(wrapped.cause, error);
    });

    it("should return VeryfrontError unchanged", () => {
      const error = CONFIG_NOT_FOUND.create();
      const wrapped = wrapUnknownError(error);

      assertEquals(wrapped, error);
      assertEquals(wrapped.slug, "config-not-found");
    });

    it("should safely replace hostile VeryfrontError proxies", () => {
      const source = CONFIG_NOT_FOUND.create();
      const hostile = new Proxy(source, {
        get(target, property, receiver): unknown {
          if (property === "slug") throw new Error("blocked");
          return Reflect.get(target, property, receiver);
        },
      });

      const wrapped = wrapUnknownError(hostile);

      assertEquals(wrapped.slug, "unknown-error");
      assertEquals(wrapped.detail, "Unknown error");
      assertEquals(wrapped.cause, undefined);
    });

    it("should wrap string error", () => {
      const wrapped = wrapUnknownError("string error");

      assertEquals(wrapped.slug, "unknown-error");
      assertEquals(wrapped.detail, "string error");
    });

    it("should wrap null error", () => {
      const wrapped = wrapUnknownError(null);

      assertEquals(wrapped.slug, "unknown-error");
      assertExists(wrapped.detail);
    });

    it("should wrap undefined error", () => {
      const wrapped = wrapUnknownError(undefined);

      assertEquals(wrapped.slug, "unknown-error");
      assertExists(wrapped.detail);
    });

    it("should wrap object error", () => {
      const obj = { message: "Custom error" };
      const wrapped = wrapUnknownError(obj);

      assertEquals(wrapped.slug, "unknown-error");
      assertExists(wrapped.detail);
    });

    it("should wrap hostile thrown values without throwing", () => {
      const hostile = new Proxy({}, {
        getPrototypeOf(): never {
          throw new Error("blocked");
        },
        get(): never {
          throw new Error("blocked");
        },
      });

      const wrapped = wrapUnknownError(hostile);

      assertEquals(wrapped.slug, "unknown-error");
      assertEquals(wrapped.detail, "Unknown error");
      assertEquals(wrapped.cause, undefined);
    });

    it("should add context when provided", () => {
      const error = new Error("Test");
      const wrapped = wrapUnknownError(error, { userId: 123, action: "fetch" });
      const context = getContext(wrapped);

      assertEquals(context.userId, 123);
      assertEquals(context.action, "fetch");
    });

    it("should preserve Error cause", () => {
      const originalError = new Error("Original");
      const wrapped = wrapUnknownError(originalError);

      assertEquals(wrapped.cause, originalError);
    });

    it("should not set cause for non-Error values", () => {
      const wrapped = wrapUnknownError("string");

      assertEquals(wrapped.cause, undefined);
    });

    it("should detach stateful errors once for boundary consumers", () => {
      let statusReads = 0;
      const source = CONFIG_NOT_FOUND.create({ detail: "Missing file" });
      const stateful = new Proxy(source, {
        get(target, property, receiver): unknown {
          if (property === "status") {
            statusReads++;
            return [404, 503, 418][statusReads - 1] ?? 418;
          }
          return Reflect.get(target, property, receiver);
        },
      });

      const detached = detachBoundaryError(stateful);

      assertEquals(detached.status, 404);
      assertEquals(detached.status, 404);
      assertEquals(statusReads, 1);
    });
  });

  describe("isVeryfrontError", () => {
    it("should return true for VeryfrontError", () => {
      const error = CONFIG_NOT_FOUND.create();
      assertEquals(isVeryfrontError(error), true);
    });

    it("should return false for plain Error", () => {
      const error = new Error("test");
      assertEquals(isVeryfrontError(error), false);
    });

    it("should return false for string", () => {
      assertEquals(isVeryfrontError("error"), false);
    });

    it("should return false for null", () => {
      assertEquals(isVeryfrontError(null), false);
    });

    it("should return false for undefined", () => {
      assertEquals(isVeryfrontError(undefined), false);
    });

    it("should return false for values that throw during inspection", () => {
      const hostile = new Proxy({}, {
        getPrototypeOf(): never {
          throw new Error("blocked");
        },
      });

      assertEquals(isVeryfrontError(hostile), false);
    });
  });

  describe("wrapWithContext", () => {
    it("should wrap plain Error with additional message", () => {
      const error = new Error("Original error");
      const wrapped = wrapWithContext(error, "Failed to process");

      assertEquals(wrapped.slug, "unknown-error");
      assertEquals(wrapped.detail, "Failed to process: Original error");
    });

    it("should preserve VeryfrontError slug but update message", () => {
      const error = CONFIG_NOT_FOUND.create({ detail: "Missing file" });
      const wrapped = wrapWithContext(error, "Build failed");

      assertEquals(wrapped.slug, "config-not-found");
      assertEquals(wrapped.detail, "Build failed: Missing file");
    });

    it("should derive all wrapped fields from one VeryfrontError snapshot", () => {
      let messageReads = 0;
      const source = CONFIG_NOT_FOUND.create({ detail: "Missing file" });
      const stateful = new Proxy(source, {
        get(target, property, receiver): unknown {
          if (property === "message") {
            messageReads++;
            if (messageReads > 1) throw new Error("message reread");
            return "Missing file";
          }
          return Reflect.get(target, property, receiver);
        },
      });

      const wrapped = wrapWithContext(stateful, "Build failed");

      assertEquals(wrapped.slug, "config-not-found");
      assertEquals(wrapped.category, "CONFIG");
      assertEquals(wrapped.status, 404);
      assertEquals(wrapped.detail, "Build failed: Missing file");
      assertEquals(messageReads, 1);
    });

    it("should add context to wrapped error", () => {
      const error = new Error("Test");
      const wrapped = wrapWithContext(error, "Operation failed", { step: "init" });

      assertEquals(getContext(wrapped).step, "init");
    });

    it("should preserve existing context in VeryfrontError", () => {
      const error = new VeryfrontError("Test", {
        slug: "test",
        category: "GENERAL",
        status: 500,
        title: "Test",
        context: { original: true },
      });

      const wrapped = wrapWithContext(error, "Wrapped", { added: true });
      const context = getContext(wrapped);

      assertEquals(context.original, true);
      assertEquals(context.added, true);
    });

    it("should store original error information in context", () => {
      const error = CONFIG_NOT_FOUND.create();
      const wrapped = wrapWithContext(error, "Wrapper");
      const context = getContext(wrapped);

      assertExists(context.originalError);
      assertEquals(
        (context.originalError as { slug?: string })?.slug,
        "config-not-found",
      );
    });

    it("should handle string errors", () => {
      const wrapped = wrapWithContext("string error", "Failed");

      assertEquals(wrapped.slug, "unknown-error");
      assertEquals(wrapped.detail, "Failed: string error");
    });

    it("should preserve cause from original error", () => {
      const originalError = new Error("Original");
      const wrapped = wrapWithContext(originalError, "Wrapped");

      assertEquals(wrapped.cause, originalError);
    });
  });
});
