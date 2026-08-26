import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { defineError, isVeryfrontErrorInstance, VeryfrontError } from "./types.ts";
import type { ErrorSlug } from "./error-registry.ts";
import { getErrorBySlug } from "./error-registry.ts";
import { ERROR_DIAGNOSTIC_MAX_LENGTH_CHARS } from "./safe-diagnostics.ts";
import { buildErrorDocsUrl, ERROR_DOCS_BASE_URL } from "./diagnostic-policy.ts";

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

    it("should use captured WeakSet methods for construction and recognition", () => {
      const originalAdd = WeakSet.prototype.add;
      const originalHas = WeakSet.prototype.has;

      try {
        WeakSet.prototype.add = function () {
          throw new Error("mutated add");
        };
        WeakSet.prototype.has = function () {
          throw new Error("mutated has");
        };

        const err = new VeryfrontError("test", {
          slug: "network-error",
          category: "SERVER",
          status: 503,
          title: "Network error",
        });

        assertEquals(isVeryfrontErrorInstance(err), true);
      } finally {
        WeakSet.prototype.add = originalAdd;
        WeakSet.prototype.has = originalHas;
      }
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
      assertEquals(rfc9457.type, "https://veryfront.com/docs/code/guides/errors#render-error");
      assertEquals(rfc9457.title, "Render error");
      assertEquals(rfc9457.status, 500);
      assertEquals(rfc9457.category, "RUNTIME");
      assertEquals(rfc9457.suggestion, "Check your component code");
      assertEquals(rfc9457.detail, "Component failed to render");
    });

    it("should degrade to the unknown-error document when a field is unreadable", () => {
      const err = new VeryfrontError("Something went wrong", {
        slug: "render-error",
        category: "RUNTIME",
        status: 500,
        title: "Render error",
      });
      Object.defineProperty(err, "slug", {
        configurable: true,
        get() {
          throw new Error("hostile");
        },
      });

      const problem = err.toRFC9457();

      assertEquals(
        problem.type,
        buildErrorDocsUrl("unknown-error"),
        "an unreadable error must degrade to the unknown-error document",
      );
      assertEquals(
        problem.title,
        "Unknown/unclassified error",
        "an unreadable error must not claim a registered title",
      );
      assertEquals(problem.status, 500, "an unreadable error is reported as a server fault");
      assertEquals(problem.category, "GENERAL", "an unreadable error has no known category");
      assertEquals(
        err.getDocsUrl().endsWith("#unknown-error"),
        true,
        "the docs URL degrades with the same fallback slug",
      );
    });

    it("should serialize a proxied error without reading its fields", () => {
      let trapReads = 0;
      const proxy = new Proxy(
        new VeryfrontError("Something went wrong", {
          slug: "render-error",
          category: "RUNTIME",
          status: 500,
          title: "Render error",
        }),
        {
          get(): never {
            trapReads++;
            throw new Error("hostile");
          },
        },
      );

      // Called through the prototype: a `get` trap would otherwise intercept
      // the method lookup itself.
      const problem = VeryfrontError.prototype.toRFC9457.call(proxy);

      assertEquals(problem.status, 500, "a proxied error must not throw out of the serializer");
      assertEquals(
        problem.type,
        buildErrorDocsUrl("unknown-error"),
        "a proxied error degrades to the unknown-error document",
      );
      assertEquals(trapReads, 0, "the serializer must not read fields off a proxy");
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
      // The hostile slug is confined to the fragment: it cannot change the
      // page it points at, nor open a query or a second fragment.
      assertEquals(parsedDocsUrl.pathname, new URL(ERROR_DOCS_BASE_URL).pathname);
      assertEquals(parsedDocsUrl.hash.slice(1).includes("#"), false);
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

      // Widening ErrorSlug to `string` would silence this directive, and the
      // unused directive is itself an error under `deno task lint:test-typecheck`.
      // @ts-expect-error an unregistered slug must not satisfy ErrorSlug
      getErrorBySlug("not-a-real-slug");

      for (const slug of slugs) {
        assertEquals(
          getErrorBySlug(slug)?.slug,
          slug,
          `registry entry for ${slug} must exist and report its own slug`,
        );
      }
    });
  });
});
