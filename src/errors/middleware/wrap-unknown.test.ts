import "#veryfront/schemas/_test-setup.ts";
/**
 * Tests for Error Wrapping Utilities
 */

import { describe, it } from "#veryfront/testing/bdd";
import { assertEquals, assertExists, assertThrows } from "#veryfront/testing/assert";
import { wrapUnknownError, wrapWithContext } from "./wrap-unknown.ts";
import { isVeryfrontError } from "../http-error.ts";
import { VeryfrontError } from "../types.ts";
import { CONFIG_NOT_FOUND } from "../error-registry.ts";

function contextOf(error: VeryfrontError): Record<string, unknown> {
  return (error.context ?? {}) as Record<string, unknown>;
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

    it("should add context when provided", () => {
      const error = new Error("Test");
      const wrapped = wrapUnknownError(error, { userId: 123, action: "fetch" });

      assertEquals(contextOf(wrapped).userId, 123);
      assertEquals(contextOf(wrapped).action, "fetch");
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

    it("bounds oversized thrown values", () => {
      const wrapped = wrapUnknownError("x".repeat(100_000));
      assertEquals((wrapped.detail?.length ?? 0) < 20_000, true);
    });

    it("fails closed for hostile context properties", () => {
      const context = Object.defineProperty({}, "payload", {
        enumerable: true,
        get() {
          throw new Error("password=<TOKEN>");
        },
      });

      const wrapped = wrapUnknownError(new Error("failed"), context);
      assertEquals((JSON.stringify(wrapped.context) ?? "").includes("<TOKEN>"), false);
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
  });

  describe("wrapWithContext", () => {
    it("rejects an invalid wrapper message", () => {
      for (const message of [null, "", "x".repeat(4_097)]) {
        assertThrows(
          () => wrapWithContext(new Error("failed"), message as never),
          TypeError,
          "message must be a non-empty string",
        );
      }
    });

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

    it("should add context to wrapped error", () => {
      const error = new Error("Test");
      const wrapped = wrapWithContext(error, "Operation failed", { step: "init" });

      assertEquals(contextOf(wrapped).step, "init");
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

      assertEquals(contextOf(wrapped).original, true);
      assertEquals(contextOf(wrapped).added, true);
    });

    it("should store original error information in context", () => {
      const error = CONFIG_NOT_FOUND.create();
      const wrapped = wrapWithContext(error, "Wrapper");

      assertExists(contextOf(wrapped).originalError);
      assertEquals(
        (contextOf(wrapped).originalError as { slug?: string })?.slug,
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

    it("handles non-record and hostile existing contexts", () => {
      const primitiveContext = new VeryfrontError("failed", {
        slug: "test",
        category: "GENERAL",
        status: 500,
        title: "Test",
        context: "not-a-record",
      });
      const hostileContext = new VeryfrontError("failed", {
        slug: "test",
        category: "GENERAL",
        status: 500,
        title: "Test",
        context: Object.defineProperty({}, "payload", {
          enumerable: true,
          get() {
            throw new Error("password=<TOKEN>");
          },
        }),
      });

      assertEquals(wrapWithContext(primitiveContext, "Wrapped").context !== null, true);
      assertEquals(
        JSON.stringify(wrapWithContext(hostileContext, "Wrapped").context).includes(
          "<TOKEN>",
        ),
        false,
      );
    });

    it("fails closed for hostile mutable error identity", () => {
      const error = CONFIG_NOT_FOUND.create();
      Object.defineProperty(error, "slug", {
        get() {
          throw new Error("getter leaked password=<TOKEN>");
        },
      });

      const wrapped = wrapWithContext(error, "Wrapped");

      assertEquals(wrapped.slug, "unknown-error");
      assertEquals(JSON.stringify(wrapped.context).includes("<TOKEN>"), false);
    });
  });
});
