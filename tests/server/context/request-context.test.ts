import { assertEquals, assertStrictEquals } from "@std/assert";
import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import {
  createRequestContext,
  getCacheStrategy,
  isLocalDev,
  shouldEnableCache,
} from "../../../src/server/context/request-context.ts";

describe("request-context", () => {
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
  });

  describe("isLocalDev", () => {
    let originalNodeEnv: string | undefined;
    let originalDenoEnv: string | undefined;

    beforeEach(() => {
      originalNodeEnv = Deno.env.get("NODE_ENV");
      originalDenoEnv = Deno.env.get("DENO_ENV");
    });

    afterEach(() => {
      if (originalNodeEnv !== undefined) {
        Deno.env.set("NODE_ENV", originalNodeEnv);
      } else {
        Deno.env.delete("NODE_ENV");
      }
      if (originalDenoEnv !== undefined) {
        Deno.env.set("DENO_ENV", originalDenoEnv);
      } else {
        Deno.env.delete("DENO_ENV");
      }
    });

    it("returns true when NODE_ENV is not set", () => {
      Deno.env.delete("NODE_ENV");
      Deno.env.delete("DENO_ENV");
      assertStrictEquals(isLocalDev(), true);
    });

    it("returns true when NODE_ENV is development", () => {
      Deno.env.set("NODE_ENV", "development");
      assertStrictEquals(isLocalDev(), true);
    });

    it("returns false when NODE_ENV is production", () => {
      Deno.env.set("NODE_ENV", "production");
      assertStrictEquals(isLocalDev(), false);
    });

    it("falls back to DENO_ENV when NODE_ENV not set", () => {
      Deno.env.delete("NODE_ENV");
      Deno.env.set("DENO_ENV", "production");
      assertStrictEquals(isLocalDev(), false);
    });
  });

  describe("getCacheStrategy", () => {
    let originalNodeEnv: string | undefined;

    beforeEach(() => {
      originalNodeEnv = Deno.env.get("NODE_ENV");
    });

    afterEach(() => {
      if (originalNodeEnv !== undefined) {
        Deno.env.set("NODE_ENV", originalNodeEnv);
      } else {
        Deno.env.delete("NODE_ENV");
      }
    });

    it("returns 'none' in development regardless of mode", () => {
      Deno.env.set("NODE_ENV", "development");

      const previewCtx = { token: "", slug: "", branch: null, mode: "preview" as const };
      const prodCtx = { token: "", slug: "", branch: null, mode: "production" as const };

      assertEquals(getCacheStrategy(previewCtx), "none");
      assertEquals(getCacheStrategy(prodCtx), "none");
    });

    it("returns 'invalidate' for preview mode in production env", () => {
      Deno.env.set("NODE_ENV", "production");

      const ctx = { token: "", slug: "", branch: null, mode: "preview" as const };
      assertEquals(getCacheStrategy(ctx), "invalidate");
    });

    it("returns 'immutable' for production mode in production env", () => {
      Deno.env.set("NODE_ENV", "production");

      const ctx = { token: "", slug: "", branch: null, mode: "production" as const };
      assertEquals(getCacheStrategy(ctx), "immutable");
    });
  });

  describe("shouldEnableCache", () => {
    let originalNodeEnv: string | undefined;

    beforeEach(() => {
      originalNodeEnv = Deno.env.get("NODE_ENV");
    });

    afterEach(() => {
      if (originalNodeEnv !== undefined) {
        Deno.env.set("NODE_ENV", originalNodeEnv);
      } else {
        Deno.env.delete("NODE_ENV");
      }
    });

    it("returns false in development", () => {
      Deno.env.set("NODE_ENV", "development");

      const ctx = { token: "", slug: "", branch: null, mode: "production" as const };
      assertStrictEquals(shouldEnableCache(ctx), false);
    });

    it("returns false for preview mode", () => {
      Deno.env.set("NODE_ENV", "production");

      const ctx = { token: "", slug: "", branch: null, mode: "preview" as const };
      assertStrictEquals(shouldEnableCache(ctx), false);
    });

    it("returns true for production mode in production env", () => {
      Deno.env.set("NODE_ENV", "production");

      const ctx = { token: "", slug: "", branch: null, mode: "production" as const };
      assertStrictEquals(shouldEnableCache(ctx), true);
    });
  });
});
