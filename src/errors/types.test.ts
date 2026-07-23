import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { defineError, VeryfrontError } from "./types.ts";
import type { ErrorSlug } from "./error-registry.ts";

describe("errors/types", () => {
  describe("VeryfrontError", () => {
    it("should set message and slug with options object", () => {
      const err = new VeryfrontError("test error", {
        slug: "build-failed",
        category: "BUILD",
        status: 500,
        title: "Build failed",
      });
      assertEquals(err.message, "test error");
      assertEquals(err.slug, "build-failed");
      assertEquals(err.category, "BUILD");
      assertEquals(err.status, 500);
      assertEquals(err.name, "VeryfrontError");
    });

    it("should set context when provided in options", () => {
      const ctx = { file: "main.ts", line: 42 };
      const err = new VeryfrontError("fail", {
        slug: "render-error",
        category: "RUNTIME",
        status: 500,
        title: "Render error",
        context: ctx,
      });
      assertEquals(err.context, ctx);
    });

    it("should have undefined context when not provided", () => {
      const err = new VeryfrontError("fail", {
        slug: "config-invalid",
        category: "CONFIG",
        status: 400,
        title: "Invalid config",
      });
      assertEquals(err.context, undefined);
    });

    it("should be an instance of Error", () => {
      const err = new VeryfrontError("test", {
        slug: "network-error",
        category: "SERVER",
        status: 503,
        title: "Network error",
      });
      assertEquals(err instanceof Error, true);
      assertEquals(err instanceof VeryfrontError, true);
    });

    it("preserves formatting whitespace while rejecting unsafe controls", () => {
      const message = "Validation failed:\n\t- missing field";
      const err = new VeryfrontError(message, {
        slug: "validation-failed",
        category: "CONFIG",
        status: 400,
        title: "Validation failed",
        detail: message,
      });

      assertEquals(err.message, message);
      assertEquals(err.detail, message);
      assertThrows(
        () =>
          new VeryfrontError("unsafe\u0000message", {
            slug: "validation-failed",
            category: "CONFIG",
            status: 400,
            title: "Validation failed",
          }),
        TypeError,
      );
    });

    it("should generate RFC 9457 response", () => {
      const err = new VeryfrontError("Something went wrong", {
        slug: "render-error",
        category: "RUNTIME",
        status: 500,
        title: "Render error",
        suggestion: "Check your component code",
        detail: "Component failed to render",
      });

      const rfc9457 = err.toRFC9457();
      assertEquals(rfc9457.type, "https://veryfront.com/docs/errors/render-error");
      assertEquals(rfc9457.title, "Render error");
      assertEquals(rfc9457.status, 500);
      assertEquals(rfc9457.category, "RUNTIME");
      assertEquals(rfc9457.suggestion, "Check your component code");
      assertEquals(rfc9457.detail, "Component failed to render");
    });

    it("sanitizes legacy RFC 9457 diagnostics", () => {
      const err = new VeryfrontError("Request failed", {
        slug: "request-error",
        category: "SERVER",
        status: 400,
        title: "Request failed",
        detail: "password=<TOKEN> at /private/project/server.ts",
        cause: "Bearer <TOKEN>",
      });

      const serialized = JSON.stringify(err.toRFC9457());
      assertEquals(serialized.includes("<TOKEN>"), false);
      assertEquals(serialized.includes("/private/project"), false);
    });

    it("should support slug type checking", () => {
      const slugs: ErrorSlug[] = [
        "config-not-found",
        "build-failed",
        "render-error",
      ];
      assertEquals(slugs.length, 3);
    });

    it("rejects malformed direct constructor options", () => {
      assertThrows(
        () =>
          new VeryfrontError("invalid", {
            slug: "Invalid Slug",
            category: "GENERAL",
            status: 500,
            title: "Invalid",
          }),
        TypeError,
      );
      assertThrows(
        () =>
          new VeryfrontError("invalid", {
            slug: "invalid-status",
            category: "GENERAL",
            status: Number.NaN,
            title: "Invalid",
          }),
        TypeError,
      );
    });

    it("fails closed when a mutable slug is used for a documentation URL", () => {
      const error = new VeryfrontError("Invalid input", {
        slug: "invalid-input",
        category: "GENERAL",
        status: 400,
        title: "Invalid input",
      });
      error.slug = "../private?token=<TOKEN>";

      assertEquals(
        error.getDocsUrl(),
        "https://veryfront.com/docs/errors/unknown-error",
      );
    });
  });

  describe("defineError", () => {
    it("rejects malformed public definitions and status overrides", () => {
      for (
        const definition of [
          { slug: "Invalid Slug", category: "GENERAL", status: 500, title: "Invalid" },
          { slug: "invalid-status", category: "GENERAL", status: Number.NaN, title: "Invalid" },
          { slug: "invalid-category", category: "UNKNOWN", status: 500, title: "Invalid" },
        ]
      ) {
        assertThrows(() => defineError(definition as never), TypeError);
      }

      const registered = defineError({
        slug: "valid-error",
        category: "GENERAL",
        status: 500,
        title: "Valid error",
      });
      assertThrows(() => registered.create({ status: Number.POSITIVE_INFINITY }), TypeError);
      assertThrows(() => registered.create({ status: 399 }), TypeError);
      assertThrows(() => registered.create({ status: 600 }), TypeError);
    });

    it("returns an immutable definition snapshot", () => {
      const definition = {
        slug: "stable-error",
        category: "GENERAL" as const,
        status: 500,
        title: "Stable error",
      };
      const registered = defineError(definition);
      definition.title = "Mutated";

      assertEquals(registered.title, "Stable error");
      assertEquals(Object.isFrozen(registered), true);
    });
  });
});
