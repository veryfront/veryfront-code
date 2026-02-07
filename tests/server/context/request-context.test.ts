import { assertEquals, assertStrictEquals } from "#std/assert";
import { describe, it } from "#std/testing/bdd";
import {
  createRequestContext,
  getCacheStrategy,
  type RequestContext,
  shouldEnableCache,
  shouldUseNoCacheHeaders,
} from "../../../src/server/context/request-context.ts";

function makeCtx(overrides: Partial<RequestContext> = {}): RequestContext {
  return {
    token: "",
    slug: "",
    branch: null,
    mode: "production",
    ...overrides,
  };
}

describe("request-context", () => {
  describe("createRequestContext", () => {
    it("extracts slug from production domain", () => {
      const ctx = createRequestContext(
        new Request("https://myapp.veryfront.com/page"),
      );

      assertEquals(ctx.slug, "myapp");
      assertEquals(ctx.mode, "production");
      assertEquals(ctx.branch, null);
    });

    it("extracts slug and sets preview mode from preview domain", () => {
      const ctx = createRequestContext(
        new Request("https://myapp.preview.veryfront.com/page"),
      );

      assertEquals(ctx.slug, "myapp");
      assertEquals(ctx.mode, "preview");
      assertEquals(ctx.branch, null);
    });

    it("extracts slug and branch from branch preview domain", () => {
      const ctx = createRequestContext(
        new Request("https://myapp--feature.preview.veryfront.com/page"),
      );

      assertEquals(ctx.slug, "myapp");
      assertEquals(ctx.mode, "preview");
      assertEquals(ctx.branch, "feature");
    });

    it("extracts slug from local dev domain (lvh.me)", () => {
      const ctx = createRequestContext(
        new Request("http://myapp.lvh.me:8080/page"),
      );

      assertEquals(ctx.slug, "myapp");
      assertEquals(ctx.mode, "production");
      assertEquals(ctx.branch, null);
    });

    it("extracts slug and sets preview mode from local preview domain", () => {
      const ctx = createRequestContext(
        new Request("http://myapp.preview.lvh.me:8080/page"),
      );

      assertEquals(ctx.slug, "myapp");
      assertEquals(ctx.mode, "preview");
      assertEquals(ctx.branch, null);
    });

    it("prefers x-token header over env var", () => {
      const ctx = createRequestContext(
        new Request("https://myapp.veryfront.com/", {
          headers: { "x-token": "header-token" },
        }),
      );

      assertEquals(ctx.token, "header-token");
    });

    it("prefers x-project-slug header over domain slug", () => {
      const ctx = createRequestContext(
        new Request("https://other.veryfront.com/", {
          headers: { "x-project-slug": "override-slug" },
        }),
      );

      assertEquals(ctx.slug, "override-slug");
    });

    it("uses both headers when provided", () => {
      const ctx = createRequestContext(
        new Request("https://myapp.preview.veryfront.com/", {
          headers: {
            "x-token": "proxy-token",
            "x-project-slug": "proxy-slug",
          },
        }),
      );

      assertEquals(ctx.token, "proxy-token");
      assertEquals(ctx.slug, "proxy-slug");
      assertEquals(ctx.mode, "preview");
    });

    it("uses x-environment header for custom domains", () => {
      const ctx = createRequestContext(
        new Request("https://custom-domain.com/page", {
          headers: { "x-environment": "preview" },
        }),
      );

      assertEquals(ctx.mode, "preview");
    });

    it("defaults to production for custom domains without header", () => {
      const ctx = createRequestContext(
        new Request("https://custom-domain.com/page"),
      );

      assertEquals(ctx.mode, "production");
    });
  });

  describe("getCacheStrategy", () => {
    it("returns 'none' when isLocalProject is true regardless of mode", () => {
      assertEquals(getCacheStrategy(makeCtx({ mode: "preview" }), true), "none");
      assertEquals(
        getCacheStrategy(makeCtx({ mode: "production" }), true),
        "none",
      );
    });

    it("returns 'invalidate' for preview mode when not local project", () => {
      assertEquals(
        getCacheStrategy(makeCtx({ mode: "preview" }), false),
        "invalidate",
      );
    });

    it("returns 'immutable' for production mode when not local project", () => {
      assertEquals(
        getCacheStrategy(makeCtx({ mode: "production" }), false),
        "immutable",
      );
    });
  });

  describe("shouldEnableCache", () => {
    it("returns false when isLocalProject is true", () => {
      assertStrictEquals(
        shouldEnableCache(makeCtx({ mode: "production" }), true),
        false,
      );
    });

    it("returns false for preview mode", () => {
      assertStrictEquals(
        shouldEnableCache(makeCtx({ mode: "preview" }), false),
        false,
      );
    });

    it("returns true for production mode when not local project", () => {
      assertStrictEquals(
        shouldEnableCache(makeCtx({ mode: "production" }), false),
        true,
      );
    });
  });

  describe("shouldUseNoCacheHeaders", () => {
    it("returns true when isLocalProject is true regardless of mode", () => {
      assertStrictEquals(
        shouldUseNoCacheHeaders(makeCtx({ mode: "preview" }), true),
        true,
      );
      assertStrictEquals(
        shouldUseNoCacheHeaders(makeCtx({ mode: "production" }), true),
        true,
      );
    });

    it("returns true for preview mode when not local project", () => {
      assertStrictEquals(
        shouldUseNoCacheHeaders(makeCtx({ mode: "preview" }), false),
        true,
      );
    });

    it("returns false for production mode when not local project", () => {
      assertStrictEquals(
        shouldUseNoCacheHeaders(makeCtx({ mode: "production" }), false),
        false,
      );
    });
  });
});
