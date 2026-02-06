import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { VeryfrontError } from "./types.ts";
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

    it("should support slug type checking", () => {
      const slugs: ErrorSlug[] = [
        "config-not-found",
        "build-failed",
        "render-error",
      ];
      assertEquals(slugs.length, 3);
    });
  });
});
