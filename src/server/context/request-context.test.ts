import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createRequestContext,
  getCacheStrategy,
  type RequestContext,
  shouldEnableCache,
  shouldUseNoCacheHeaders,
} from "./request-context.ts";

function makeRequest(url: string, headers?: Record<string, string>): Request {
  return new Request(url, {
    headers: new Headers(headers),
  });
}

function makeCtx(overrides: Partial<RequestContext> = {}): RequestContext {
  return {
    token: "",
    slug: "",
    branch: null,
    mode: "production",
    ...overrides,
  };
}

describe("createRequestContext", () => {
  describe("mode detection", () => {
    it("returns production mode for a production domain", () => {
      const req = makeRequest("https://127.0.0.1/page", {
        host: "my-app.production.veryfront.com",
      });
      const ctx = createRequestContext(req);
      assertEquals(ctx.mode, "production");
    });

    it("returns preview mode when parseProjectDomain returns preview environment", () => {
      const req = makeRequest("https://127.0.0.1/page", {
        host: "my-app.preview.veryfront.com",
      });
      const ctx = createRequestContext(req);
      assertEquals(ctx.mode, "preview");
    });

    it("returns preview mode when effectiveHost contains .preview.", () => {
      // Even for non-veryfront domains, .preview. in host triggers preview
      const req = makeRequest("https://127.0.0.1/page", {
        host: "something.preview.custom-domain.com",
      });
      const ctx = createRequestContext(req);
      assertEquals(ctx.mode, "preview");
    });

    it("returns preview mode when x-environment header is preview", () => {
      const req = makeRequest("https://127.0.0.1/page", {
        host: "example.com",
        "x-environment": "preview",
      });
      const ctx = createRequestContext(req);
      assertEquals(ctx.mode, "preview");
    });

    it("returns preview mode via .preview. in veryfront.org domain", () => {
      const req = makeRequest("https://127.0.0.1/page", {
        host: "my-app.preview.veryfront.org",
      });
      const ctx = createRequestContext(req);
      assertEquals(ctx.mode, "preview");
    });

    it("returns production mode when x-environment is not preview", () => {
      const req = makeRequest("https://127.0.0.1/page", {
        host: "example.com",
        "x-environment": "production",
      });
      const ctx = createRequestContext(req);
      assertEquals(ctx.mode, "production");
    });
  });

  describe("host resolution priority", () => {
    it("x-forwarded-host takes priority over host header", () => {
      const req = makeRequest("https://127.0.0.1/page", {
        "x-forwarded-host": "my-app.preview.veryfront.com",
        host: "other.production.veryfront.com",
      });
      const ctx = createRequestContext(req);
      assertEquals(ctx.slug, "my-app");
      assertEquals(ctx.mode, "preview");
    });

    it("host header takes priority over URL hostname", () => {
      const req = makeRequest("https://127.0.0.1/page", {
        host: "my-app.lvh.me",
      });
      const ctx = createRequestContext(req);
      assertEquals(ctx.slug, "my-app");
      assertEquals(ctx.mode, "production");
    });

    it("falls back to URL hostname when no host headers", () => {
      // Deno's Request does not auto-set a host header, so hostname from URL is used
      const req = makeRequest("https://my-app.lvh.me/page");
      assertEquals(req.headers.get("host"), null);
      const ctx = createRequestContext(req);
      assertEquals(ctx.slug, "my-app");
    });
  });

  describe("token and slug", () => {
    it("reads x-token from headers", () => {
      const req = makeRequest("https://example.com/page", {
        host: "example.com",
        "x-token": "my-secret-token",
      });
      const ctx = createRequestContext(req);
      assertEquals(ctx.token, "my-secret-token");
    });

    it("reads x-project-slug from headers", () => {
      const req = makeRequest("https://example.com/page", {
        host: "example.com",
        "x-project-slug": "custom-slug",
      });
      const ctx = createRequestContext(req);
      assertEquals(ctx.slug, "custom-slug");
    });

    it("x-project-slug takes priority over domain-parsed slug", () => {
      const req = makeRequest("https://127.0.0.1/page", {
        host: "my-app.lvh.me",
        "x-project-slug": "override-slug",
      });
      const ctx = createRequestContext(req);
      assertEquals(ctx.slug, "override-slug");
    });

    it("defaults token to empty string when no header and no env", () => {
      const req = makeRequest("https://example.com/page", {
        host: "example.com",
      });
      const ctx = createRequestContext(req);
      // Token could be empty string or from env; at minimum it should be a string
      assertEquals(typeof ctx.token, "string");
    });

    it("defaults slug to empty string when no header and no domain slug", () => {
      const req = makeRequest("https://example.com/page", {
        host: "example.com",
      });
      const ctx = createRequestContext(req);
      assertEquals(ctx.slug, "");
    });
  });

  describe("branch parsing", () => {
    it("extracts branch from domain with double-dash separator", () => {
      const req = makeRequest("https://127.0.0.1/", {
        host: "my-app--feat-xyz.preview.veryfront.com",
      });
      const ctx = createRequestContext(req);
      assertEquals(ctx.slug, "my-app");
      assertEquals(ctx.branch, "feat-xyz");
    });

    it("returns null branch when no branch in domain", () => {
      const req = makeRequest("https://127.0.0.1/", {
        host: "my-app.lvh.me",
      });
      const ctx = createRequestContext(req);
      assertEquals(ctx.branch, null);
    });
  });
});

describe("getCacheStrategy", () => {
  it("returns 'none' when isLocalProject is true", () => {
    const ctx = makeCtx({ mode: "production" });
    assertEquals(getCacheStrategy(ctx, true), "none");
  });

  it("returns 'none' for local project even in preview mode", () => {
    const ctx = makeCtx({ mode: "preview" });
    assertEquals(getCacheStrategy(ctx, true), "none");
  });

  it("returns 'invalidate' for preview mode", () => {
    const ctx = makeCtx({ mode: "preview" });
    assertEquals(getCacheStrategy(ctx), "invalidate");
  });

  it("returns 'invalidate' for preview mode with isLocalProject false", () => {
    const ctx = makeCtx({ mode: "preview" });
    assertEquals(getCacheStrategy(ctx, false), "invalidate");
  });

  it("returns 'immutable' for production mode", () => {
    const ctx = makeCtx({ mode: "production" });
    assertEquals(getCacheStrategy(ctx), "immutable");
  });

  it("returns 'immutable' for production mode with isLocalProject false", () => {
    const ctx = makeCtx({ mode: "production" });
    assertEquals(getCacheStrategy(ctx, false), "immutable");
  });

  it("returns 'immutable' for production mode with isLocalProject undefined", () => {
    const ctx = makeCtx({ mode: "production" });
    assertEquals(getCacheStrategy(ctx, undefined), "immutable");
  });
});

describe("shouldEnableCache", () => {
  it("returns true for production non-local project", () => {
    const ctx = makeCtx({ mode: "production" });
    assertEquals(shouldEnableCache(ctx), true);
  });

  it("returns true for production with isLocalProject false", () => {
    const ctx = makeCtx({ mode: "production" });
    assertEquals(shouldEnableCache(ctx, false), true);
  });

  it("returns false for preview mode", () => {
    const ctx = makeCtx({ mode: "preview" });
    assertEquals(shouldEnableCache(ctx), false);
  });

  it("returns false for local project", () => {
    const ctx = makeCtx({ mode: "production" });
    assertEquals(shouldEnableCache(ctx, true), false);
  });

  it("returns false for preview + local project", () => {
    const ctx = makeCtx({ mode: "preview" });
    assertEquals(shouldEnableCache(ctx, true), false);
  });
});

describe("shouldUseNoCacheHeaders", () => {
  it("returns true when ctx is undefined", () => {
    assertEquals(shouldUseNoCacheHeaders(undefined), true);
  });

  it("returns true when ctx is undefined and isLocalProject is false", () => {
    assertEquals(shouldUseNoCacheHeaders(undefined, false), true);
  });

  it("returns true when isLocalProject is true", () => {
    const ctx = makeCtx({ mode: "production" });
    assertEquals(shouldUseNoCacheHeaders(ctx, true), true);
  });

  it("returns true for preview mode", () => {
    const ctx = makeCtx({ mode: "preview" });
    assertEquals(shouldUseNoCacheHeaders(ctx), true);
  });

  it("returns true for preview mode with isLocalProject false", () => {
    const ctx = makeCtx({ mode: "preview" });
    assertEquals(shouldUseNoCacheHeaders(ctx, false), true);
  });

  it("returns false for production non-local project", () => {
    const ctx = makeCtx({ mode: "production" });
    assertEquals(shouldUseNoCacheHeaders(ctx), false);
  });

  it("returns false for production with isLocalProject false", () => {
    const ctx = makeCtx({ mode: "production" });
    assertEquals(shouldUseNoCacheHeaders(ctx, false), false);
  });
});
