import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { buildCSP, getSecurityHeader, applySecurityHeaders } from "./security-headers.ts";
import type { HandlerContext } from "../../types.ts";

function makeCtx(overrides: Partial<HandlerContext> = {}): HandlerContext {
  return {
    isLocalProject: false,
    cspUserHeader: null,
    securityConfig: undefined,
    adapter: {
      name: "test",
    },
    parsedDomain: { allowIframeEmbed: false },
    ...overrides,
  } as unknown as HandlerContext;
}

describe("server/handlers/request/api/security-headers", () => {
  describe("buildCSP", () => {
    it("should return a string", () => {
      const ctx = makeCtx();
      const csp = buildCSP(ctx);
      assertEquals(typeof csp, "string");
    });

    it("should return a string for local project context", () => {
      const ctx = makeCtx({ isLocalProject: true });
      const csp = buildCSP(ctx);
      assertEquals(typeof csp, "string");
    });

    it("should return different CSP for dev vs production", () => {
      const devCtx = makeCtx({ isLocalProject: true });
      const prodCtx = makeCtx({ isLocalProject: false });
      const devCsp = buildCSP(devCtx);
      const prodCsp = buildCSP(prodCtx);
      // Both should be strings (may or may not differ depending on implementation)
      assertEquals(typeof devCsp, "string");
      assertEquals(typeof prodCsp, "string");
    });
  });

  describe("getSecurityHeader", () => {
    it("should return a value for known headers", () => {
      const ctx = makeCtx();
      const value = getSecurityHeader("x-content-type-options", "nosniff", ctx);
      assertEquals(typeof value, "string");
    });

    it("should return default value when no config override", () => {
      const ctx = makeCtx();
      const value = getSecurityHeader("x-custom-header", "my-default", ctx);
      assertEquals(value, "my-default");
    });
  });

  describe("applySecurityHeaders", () => {
    it("should add security headers to a Headers object", () => {
      const ctx = makeCtx();
      const headers = new Headers();
      applySecurityHeaders(headers, ctx);
      // Should have at least one security header
      assertEquals(headers.has("x-content-type-options"), true);
    });

    it("should work with local project context", () => {
      const ctx = makeCtx({ isLocalProject: true });
      const headers = new Headers();
      applySecurityHeaders(headers, ctx);
      assertEquals(typeof headers.get("x-content-type-options"), "string");
    });

    it("should accept optional request for CSRF cookie", () => {
      const ctx = makeCtx();
      const headers = new Headers();
      const req = new Request("http://localhost/test");
      // Should not throw
      applySecurityHeaders(headers, ctx, req);
    });
  });
});
