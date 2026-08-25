import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertNotEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { applySecurityHeaders, buildCSP, getSecurityHeader } from "./security-headers.ts";
import type { HandlerContext } from "../../types.ts";

function makeCtx(overrides: Partial<HandlerContext> = {}): HandlerContext {
  return {
    isLocalProject: false,
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
      assertStringIncludes(prodCsp, "default-src 'self'", "the production floor must be served");
      assertStringIncludes(prodCsp, "frame-ancestors 'none'", "production must not be framable");
      assertStringIncludes(prodCsp, "nonce-", "production must carry a script nonce");
      assertEquals(devCsp, "", "dev must serve no policy so HMR is never blocked");
      assertNotEquals(devCsp, prodCsp, "dev and production policies must differ");
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
      assertStringIncludes(
        headers.get("strict-transport-security") ?? "",
        "max-age=",
        "production must serve HSTS",
      );
      assertEquals(headers.get("x-frame-options"), "DENY", "production must deny framing");
      assertStringIncludes(
        headers.get("content-security-policy-report-only") ?? "",
        "frame-ancestors 'none'",
        "a customer app must not be framable",
      );
    });

    it("should allow the Studio frame-ancestors allowlist for embeddable domains", () => {
      const ctx = makeCtx({ parsedDomain: { allowIframeEmbed: true } } as never);
      const headers = new Headers();
      applySecurityHeaders(headers, ctx);
      assertStringIncludes(
        headers.get("content-security-policy-report-only") ?? "",
        "frame-ancestors 'self' https://veryfront.com",
        "a veryfront-managed domain must get the Studio allowlist",
      );
    });

    it("should work with local project context", () => {
      const ctx = makeCtx({ isLocalProject: true });
      const headers = new Headers();
      applySecurityHeaders(headers, ctx);
      assertEquals(typeof headers.get("x-content-type-options"), "string");
    });

    it("should accept optional request for CSRF cookie", () => {
      const ctx = makeCtx({ securityConfig: { csrf: true } } as never);
      const headers = new Headers();
      const req = new Request("http://localhost/page", { headers: { accept: "text/html" } });
      applySecurityHeaders(headers, ctx, req);
      assertEquals(
        headers.get("set-cookie")?.includes("__Host-vf_csrf=") ?? false,
        true,
        "an HTML GET must be issued a CSRF cookie",
      );
    });

    it("should not issue a CSRF cookie without csrf config", () => {
      const ctx = makeCtx({ securityConfig: {} } as never);
      const headers = new Headers();
      const req = new Request("http://localhost/page", { headers: { accept: "text/html" } });
      applySecurityHeaders(headers, ctx, req);
      assertEquals(headers.get("set-cookie"), null, "no CSRF cookie without csrf config");
    });

    it("should issue a CSRF cookie in local development when csrf is unset", () => {
      const ctx = makeCtx({ isLocalProject: true, securityConfig: {} } as never);
      const headers = new Headers();
      const req = new Request("http://localhost/page", { headers: { accept: "text/html" } });
      applySecurityHeaders(headers, ctx, req);
      assertEquals(
        headers.get("set-cookie")?.includes("__Host-vf_csrf=") ?? false,
        true,
        "local development must issue the token cookie so csrfMutationHeaders can echo it before deploy",
      );
    });

    it("should not issue a CSRF cookie locally when csrf is explicitly disabled", () => {
      const ctx = makeCtx({ isLocalProject: true, securityConfig: { csrf: false } } as never);
      const headers = new Headers();
      const req = new Request("http://localhost/page", { headers: { accept: "text/html" } });
      applySecurityHeaders(headers, ctx, req);
      assertEquals(
        headers.get("set-cookie"),
        null,
        "an explicit opt-out must stay honoured in local development",
      );
    });
  });
});
