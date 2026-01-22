import { assertEquals, assertStrictEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import {
  createEnvConfig,
  createRequestContext,
  type EnvConfig,
  getCacheStrategy,
  isLocalDev,
  type RequestContext,
  shouldEnableCache,
  shouldUseNoCacheHeaders,
} from "../../../src/server/context/request-context.ts";

// Helper to create minimal RequestContext for testing
function makeCtx(
  overrides: Partial<RequestContext> = {},
): RequestContext {
  return {
    token: "",
    slug: "",
    branch: null,
    mode: "production",
    isLocalDev: false,
    ...overrides,
  };
}

describe("request-context", () => {
  describe("createEnvConfig", () => {
    it("returns an EnvConfig with isLocalDev boolean", () => {
      const config = createEnvConfig();
      assertEquals(typeof config.isLocalDev, "boolean");
    });
  });

  describe("createRequestContext", () => {
    it("extracts slug from production domain", () => {
      const req = new Request("https://myapp.veryfront.com/page");
      const ctx = createRequestContext(req);

      assertEquals(ctx.slug, "myapp");
      assertEquals(ctx.mode, "production");
      assertEquals(ctx.branch, null);
    });

    it("extracts slug and sets preview mode from preview domain", () => {
      const req = new Request("https://myapp.preview.veryfront.com/page");
      const ctx = createRequestContext(req);

      assertEquals(ctx.slug, "myapp");
      assertEquals(ctx.mode, "preview");
      assertEquals(ctx.branch, null);
    });

    it("extracts slug and branch from branch preview domain", () => {
      const req = new Request("https://myapp--feature.preview.veryfront.com/page");
      const ctx = createRequestContext(req);

      assertEquals(ctx.slug, "myapp");
      assertEquals(ctx.mode, "preview");
      assertEquals(ctx.branch, "feature");
    });

    it("extracts slug from local dev domain (lvh.me)", () => {
      const req = new Request("http://myapp.lvh.me:8080/page");
      const ctx = createRequestContext(req);

      assertEquals(ctx.slug, "myapp");
      assertEquals(ctx.mode, "production");
      assertEquals(ctx.branch, null);
    });

    it("extracts slug and sets preview mode from local preview domain", () => {
      const req = new Request("http://myapp.preview.lvh.me:8080/page");
      const ctx = createRequestContext(req);

      assertEquals(ctx.slug, "myapp");
      assertEquals(ctx.mode, "preview");
      assertEquals(ctx.branch, null);
    });

    it("prefers x-token header over env var", () => {
      const req = new Request("https://myapp.veryfront.com/", {
        headers: { "x-token": "header-token" },
      });
      const ctx = createRequestContext(req);

      assertEquals(ctx.token, "header-token");
    });

    it("prefers x-project-slug header over domain slug", () => {
      const req = new Request("https://other.veryfront.com/", {
        headers: { "x-project-slug": "override-slug" },
      });
      const ctx = createRequestContext(req);

      assertEquals(ctx.slug, "override-slug");
    });

    it("uses both headers when provided", () => {
      const req = new Request("https://myapp.preview.veryfront.com/", {
        headers: {
          "x-token": "proxy-token",
          "x-project-slug": "proxy-slug",
        },
      });
      const ctx = createRequestContext(req);

      assertEquals(ctx.token, "proxy-token");
      assertEquals(ctx.slug, "proxy-slug");
      assertEquals(ctx.mode, "preview"); // Still from domain
    });

    it("uses x-environment header for custom domains", () => {
      // Custom domain (no .preview.) but proxy sets x-environment: preview
      const req = new Request("https://custom-domain.com/page", {
        headers: { "x-environment": "preview" },
      });
      const ctx = createRequestContext(req);

      assertEquals(ctx.mode, "preview");
    });

    it("defaults to production for custom domains without header", () => {
      const req = new Request("https://custom-domain.com/page");
      const ctx = createRequestContext(req);

      assertEquals(ctx.mode, "production");
    });

    it("uses envConfig.isLocalDev when provided", () => {
      const req = new Request("https://myapp.veryfront.com/");

      const devCtx = createRequestContext(req, { isLocalDev: true });
      assertEquals(devCtx.isLocalDev, true);

      const prodCtx = createRequestContext(req, { isLocalDev: false });
      assertEquals(prodCtx.isLocalDev, false);
    });
  });

  describe("isLocalDev", () => {
    it("returns a boolean", () => {
      assertEquals(typeof isLocalDev(), "boolean");
    });
  });

  describe("getCacheStrategy", () => {
    it("returns 'none' when isLocalDev is true regardless of mode", () => {
      const previewCtx = makeCtx({ mode: "preview", isLocalDev: true });
      const prodCtx = makeCtx({ mode: "production", isLocalDev: true });

      assertEquals(getCacheStrategy(previewCtx), "none");
      assertEquals(getCacheStrategy(prodCtx), "none");
    });

    it("returns 'invalidate' for preview mode when not local dev", () => {
      const ctx = makeCtx({ mode: "preview", isLocalDev: false });
      assertEquals(getCacheStrategy(ctx), "invalidate");
    });

    it("returns 'immutable' for production mode when not local dev", () => {
      const ctx = makeCtx({ mode: "production", isLocalDev: false });
      assertEquals(getCacheStrategy(ctx), "immutable");
    });
  });

  describe("shouldEnableCache", () => {
    it("returns false when isLocalDev is true", () => {
      const ctx = makeCtx({ mode: "production", isLocalDev: true });
      assertStrictEquals(shouldEnableCache(ctx), false);
    });

    it("returns false for preview mode", () => {
      const ctx = makeCtx({ mode: "preview", isLocalDev: false });
      assertStrictEquals(shouldEnableCache(ctx), false);
    });

    it("returns true for production mode when not local dev", () => {
      const ctx = makeCtx({ mode: "production", isLocalDev: false });
      assertStrictEquals(shouldEnableCache(ctx), true);
    });
  });

  describe("shouldUseNoCacheHeaders", () => {
    it("returns true when isLocalDev is true regardless of mode", () => {
      const previewCtx = makeCtx({ mode: "preview", isLocalDev: true });
      const prodCtx = makeCtx({ mode: "production", isLocalDev: true });

      assertStrictEquals(shouldUseNoCacheHeaders(previewCtx), true);
      assertStrictEquals(shouldUseNoCacheHeaders(prodCtx), true);
    });

    it("returns true for preview mode when not local dev", () => {
      const ctx = makeCtx({ mode: "preview", isLocalDev: false });
      assertStrictEquals(shouldUseNoCacheHeaders(ctx), true);
    });

    it("returns false for production mode when not local dev", () => {
      const ctx = makeCtx({ mode: "production", isLocalDev: false });
      assertStrictEquals(shouldUseNoCacheHeaders(ctx), false);
    });

    it("falls back to isLocalDev() when no context provided", () => {
      // When no context, it should return based on current environment
      assertEquals(typeof shouldUseNoCacheHeaders(), "boolean");
    });
  });
});
