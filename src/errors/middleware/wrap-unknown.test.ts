/**
 * Tests for Error Wrapping Utilities
 */

import { describe, it } from "#veryfront/testing/bdd";
import { assertEquals, assertExists } from "#veryfront/testing/assert";
import { isVeryfrontError, wrapUnknownError, wrapWithContext } from "./wrap-unknown.ts";
import { VeryfrontError } from "../types.ts";
import { CONFIG_NOT_FOUND } from "../error-registry.ts";

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

      assertEquals(wrapped.context?.userId, 123);
      assertEquals(wrapped.context?.action, "fetch");
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

      assertEquals(wrapped.context?.step, "init");
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

      assertEquals(wrapped.context?.original, true);
      assertEquals(wrapped.context?.added, true);
    });

    it("should store original error information in context", () => {
      const error = CONFIG_NOT_FOUND.create();
      const wrapped = wrapWithContext(error, "Wrapper");

      assertExists(wrapped.context?.originalError);
      assertEquals(
        (wrapped.context?.originalError as { slug?: string })?.slug,
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
