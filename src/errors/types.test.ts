import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { defineError, snapshotVeryfrontError, VeryfrontError } from "./types.ts";
import type { ErrorSlug } from "./error-registry.ts";
import { ERROR_DIAGNOSTIC_MAX_LENGTH_CHARS } from "./safe-diagnostics.ts";

describe("errors/types", () => {
  describe("defineError", () => {
    it("should snapshot and freeze registered definitions", () => {
      const definition = {
        slug: "test-error",
        category: "GENERAL" as const,
        status: 500,
        title: "Test error",
      };
      const registered = defineError(definition);

      definition.title = "Mutated title";

      assertEquals(Object.isFrozen(registered), true);
      assertEquals(registered.title, "Test error");
      assertEquals(registered.create().title, "Test error");
    });

    it("should preserve custom public slugs and statuses", () => {
      const registered = defineError({
        slug: "vendor/custom error",
        category: "GENERAL",
        status: 299,
        title: "Vendor error",
      });

      const error = registered.create({ status: 399 });
      assertEquals(error.slug, "vendor/custom error");
      assertEquals(error.status, 399);
    });

    it("should read each create option at most once", () => {
      const registered = defineError({
        slug: "stable-options",
        category: "GENERAL",
        status: 500,
        title: "Stable options",
      });
      let detailReads = 0;
      const options = Object.defineProperty({}, "detail", {
        enumerable: true,
        get() {
          detailReads++;
          return detailReads === 1 ? "first detail" : "changed detail";
        },
      });

      const error = registered.create(options);

      assertEquals(error.message, "first detail");
      assertEquals(error.detail, "first detail");
      assertEquals(detailReads, 1);
    });
  });

  describe("VeryfrontError", () => {
    it("does not follow inherited descriptor values for accessor-backed fields", () => {
      const err = new VeryfrontError("test error", {
        slug: "build-failed",
        category: "BUILD",
        status: 500,
        title: "Build failed",
      });
      let slugAccessorCalls = 0;
      Object.defineProperty(err, "slug", {
        configurable: true,
        get(): never {
          slugAccessorCalls += 1;
          throw new Error("slug accessor must not run");
        },
      });

      const previous = Object.getOwnPropertyDescriptor(Object.prototype, "value");
      let inheritedValueCalls = 0;
      let snapshot: ReturnType<typeof snapshotVeryfrontError>;
      Object.defineProperty(Object.prototype, "value", {
        configurable: true,
        get(): never {
          inheritedValueCalls += 1;
          throw new Error("inherited descriptor value must not run");
        },
      });

      try {
        snapshot = snapshotVeryfrontError(err);
      } finally {
        if (previous) {
          Object.defineProperty(Object.prototype, "value", previous);
        } else {
          delete (Object.prototype as Record<string, unknown>).value;
        }
      }

      assertEquals(snapshot, null);
      assertEquals(slugAccessorCalls, 0);
      assertEquals(inheritedValueCalls, 0);
    });

    it("does not read inherited descriptor-map entries for missing fields", () => {
      const err = new VeryfrontError("test error", {
        slug: "build-failed",
        category: "BUILD",
        status: 500,
        title: "Build failed",
      });
      Reflect.deleteProperty(err, "slug");

      const previous = Object.getOwnPropertyDescriptor(Object.prototype, "slug");
      let inheritedSlugCalls = 0;
      let snapshot: ReturnType<typeof snapshotVeryfrontError>;
      Object.defineProperty(Object.prototype, "slug", {
        configurable: true,
        get(): never {
          inheritedSlugCalls += 1;
          throw new Error("inherited descriptor-map entry must not run");
        },
      });

      try {
        snapshot = snapshotVeryfrontError(err);
      } finally {
        if (previous) {
          Object.defineProperty(Object.prototype, "slug", previous);
        } else {
          delete (Object.prototype as Record<string, unknown>).slug;
        }
      }

      assertEquals(snapshot, null);
      assertEquals(inheritedSlugCalls, 0);
    });

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

    it("should safely encode hostile docs slugs and bound direct RFC diagnostics", () => {
      const err = new VeryfrontError("Vendor error", {
        slug: "vendor/path?token=slug-secret#fragment%value\ud800",
        category: "GENERAL",
        status: 499,
        title: "t".repeat(ERROR_DIAGNOSTIC_MAX_LENGTH_CHARS + 100),
        detail: "Authorization: Bearer detail-secret",
        cause: "apiKey=cause-secret",
      });

      const docsUrl = err.getDocsUrl();
      const parsedDocsUrl = new URL(docsUrl);
      const problem = err.toRFC9457();

      assertEquals(parsedDocsUrl.search, "");
      assertEquals(parsedDocsUrl.hash, "");
      assert(docsUrl.includes("%2F"));
      assert(docsUrl.includes("%3F"));
      assert(docsUrl.includes("%23"));
      assert(docsUrl.includes("%25"));
      assert(docsUrl.includes("%EF%BF%BD"));
      assertEquals(docsUrl.includes("slug-secret"), false);
      assertEquals(problem.type, docsUrl);
      assertEquals(problem.title.length, ERROR_DIAGNOSTIC_MAX_LENGTH_CHARS);
      assertEquals(problem.detail?.includes("detail-secret"), false);
      assertEquals(problem.cause?.includes("cause-secret"), false);
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
