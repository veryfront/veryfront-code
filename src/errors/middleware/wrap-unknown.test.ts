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

    it("should detach a VeryfrontError from mutable caller-owned state", () => {
      const context = { operation: "initial" };
      const error = CONFIG_NOT_FOUND.create({ context });
      const wrapped = wrapUnknownError(error);

      context.operation = "mutated";

      assertEquals(wrapped === error, false);
      assertEquals(wrapped.slug, "config-not-found");
      assertEquals(wrapped.context, undefined);
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

    it("should redact credentials and detach the caller context", () => {
      const callerContext: Record<string, unknown> = {
        authorization: "Bearer <TOKEN>",
        userId: 1,
      };
      const wrapped = wrapUnknownError(new Error("boom"), callerContext);

      callerContext.userId = 2;
      const context = getContext(wrapped);

      assertEquals(
        context.authorization,
        "[REDACTED]",
        "credential-bearing context keys must be redacted before attachment",
      );
      assertEquals(
        context.userId,
        1,
        "the attached context must be a detached snapshot, not the caller's object",
      );
      assertEquals(
        context === callerContext,
        false,
        "the error must not retain the caller's object identity",
      );
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

    it("should treat proxied errors as opaque without invoking traps", () => {
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

      assertEquals(detached.status, 500);
      assertEquals(detached.slug, "unknown-error");
      assertEquals(statusReads, 0);
    });

    it("should not invoke object conversion hooks", () => {
      let coercions = 0;
      const hostile = {
        [Symbol.toPrimitive](): never {
          coercions++;
          throw new Error("conversion hook must not run");
        },
      };

      const wrapped = wrapUnknownError(hostile);

      assertEquals(wrapped.slug, "unknown-error");
      assertEquals(wrapped.detail, "Unknown error");
      assertEquals(coercions, 0);
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

    it("should reject proxies without invoking their prototype trap", () => {
      let prototypeReads = 0;
      const hostile = new Proxy({}, {
        getPrototypeOf(target): object | null {
          prototypeReads++;
          return Reflect.getPrototypeOf(target);
        },
      });

      assertEquals(isVeryfrontError(hostile), false);
      assertEquals(prototypeReads, 0);
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
      assertEquals(wrapped.status, 404, "wrapped error keeps the original HTTP status");
      assertEquals(wrapped.category, "CONFIG", "wrapped error keeps the original category");
      assertEquals(
        wrapped.title,
        "Configuration file not found",
        "wrapped error keeps the registry title",
      );
    });

    it("should preserve the remaining identity fields of a VeryfrontError", () => {
      const error = new VeryfrontError("boom", {
        slug: "test-error",
        category: "GENERAL",
        status: 503,
        title: "Test",
        suggestion: "Retry",
        exitCode: 2,
        instance: "/custom/instance",
      });

      const wrapped = wrapWithContext(error, "Build failed");

      assertEquals(wrapped.status, 503, "wrapped error keeps the original HTTP status");
      assertEquals(wrapped.suggestion, "Retry", "wrapped error keeps the original suggestion");
      assertEquals(wrapped.exitCode, 2, "wrapped error keeps the original CLI exit code");
      assertEquals(
        wrapped.instance,
        "/custom/instance",
        "wrapped error keeps the original instance",
      );
    });

    it("should degrade a tampered VeryfrontError to unknown-error", () => {
      const error = new VeryfrontError("boom", {
        slug: "config-not-found",
        category: "CONFIG",
        status: 404,
        title: "Configuration file not found",
      });
      Object.defineProperty(error, "status", { get: () => 500, configurable: true });

      const wrapped = wrapWithContext(error, "Build failed", { step: "init" });

      assertEquals(
        wrapped.slug,
        "unknown-error",
        "a tampered VeryfrontError must degrade to unknown-error",
      );
      assertEquals(
        wrapped.detail,
        "Build failed: Unknown error",
        "detail must keep the caller message",
      );
      assertEquals(
        getContext(wrapped).step,
        "init",
        "supplied context must survive the degradation branch",
      );
    });

    it("should treat proxied VeryfrontErrors as opaque without reading fields", () => {
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

      assertEquals(wrapped.slug, "unknown-error");
      assertEquals(wrapped.category, "GENERAL");
      assertEquals(wrapped.status, 500);
      assertEquals(wrapped.detail, "Build failed: Unknown error");
      assertEquals(messageReads, 0);
    });

    it("should add context to wrapped error", () => {
      const error = new Error("Test");
      const wrapped = wrapWithContext(error, "Operation failed", { step: "init" });

      assertEquals(getContext(wrapped).step, "init");
    });

    it("should redact credentials and detach the caller context", () => {
      const callerContext: Record<string, unknown> = {
        authorization: "Bearer <TOKEN>",
        userId: 1,
      };
      const wrapped = wrapWithContext(new Error("boom"), "Operation failed", callerContext);

      callerContext.userId = 2;
      const context = getContext(wrapped);

      assertEquals(
        context.authorization,
        "[REDACTED]",
        "credential-bearing context keys must be redacted before attachment",
      );
      assertEquals(
        context.userId,
        1,
        "the attached context must be a detached snapshot, not the caller's object",
      );
      assertEquals(
        context === callerContext,
        false,
        "the error must not retain the caller's object identity",
      );
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
