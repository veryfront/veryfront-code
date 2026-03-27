import { describe, it } from "#veryfront/testing/bdd.ts";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import {
  applySecurityHeaders,
  buildCSP,
  generateNonce,
  getSecurityHeader,
} from "./security-handler.ts";
import type { SecurityConfig } from "./types.ts";

function createMockAdapter(
  envMap: Record<string, string> = {},
): import("#veryfront/platform/adapters/base.ts").RuntimeAdapter {
  return {
    env: {
      get(key: string) {
        return envMap[key];
      },
    },
  } as import("#veryfront/platform/adapters/base.ts").RuntimeAdapter;
}

describe("security/http/response/security-handler", () => {
  describe("generateNonce", () => {
    it("should return a base64-encoded string", () => {
      const nonce = generateNonce();
      assert(typeof nonce === "string");
      assert(nonce.length > 0);
    });

    it("should return different values on each call", () => {
      const a = generateNonce();
      const b = generateNonce();
      assert(a !== b, "Expected unique nonces");
    });
  });

  describe("buildCSP", () => {
    it("should return default CSP in production when no CSP is configured", () => {
      const result = buildCSP(false, "test-nonce", null);
      assert(result.includes("default-src 'self'"), "should have default-src");
      assert(result.includes("'nonce-test-nonce'"), "should include nonce in script-src");
      assert(result.includes("object-src 'none'"), "should block objects");
      assert(result.includes("frame-src 'self'"), "should allow same-origin frames");
      assert(result.includes("base-uri 'self'"), "should restrict base-uri");
    });

    it("should return empty string in dev mode when no CSP is configured", () => {
      const result = buildCSP(true, "test-nonce", null);
      assertEquals(result, "");
    });

    it("should use env CSP when set", () => {
      const adapter = createMockAdapter({
        VERYFRONT_CSP: "default-src 'self' 'nonce-{NONCE}'",
      });
      const result = buildCSP(false, "abc123", null, null, adapter);
      assertEquals(result, "default-src 'self' 'nonce-abc123'");
    });

    it("should use cspUserHeader when set", () => {
      const result = buildCSP(false, "xyz", "script-src 'nonce-{NONCE}'");
      assertEquals(result, "script-src 'nonce-xyz'");
    });

    it("should build CSP from config csp object", () => {
      const config: SecurityConfig = {
        csp: {
          "default-src": "'self'",
          "script-src": "'nonce-{NONCE}'",
        },
      };
      const result = buildCSP(false, "n1", null, config);
      assert(result.includes("default-src 'self'"));
      assert(result.includes("script-src 'nonce-n1'"));
    });

    it("should handle camelCase CSP directive keys", () => {
      const config: SecurityConfig = {
        csp: {
          defaultSrc: "'self'",
          scriptSrc: "'nonce-{NONCE}'",
        },
      };
      const result = buildCSP(false, "n2", null, config);
      assert(result.includes("default-src 'self'"));
      assert(result.includes("script-src 'nonce-n2'"));
    });

    it("should handle array CSP directive values", () => {
      const config: SecurityConfig = {
        csp: {
          "default-src": ["'self'", "https://cdn.example.com"],
        },
      };
      const result = buildCSP(false, "n3", null, config);
      assert(result.includes("default-src 'self' https://cdn.example.com"));
    });

    it("should skip undefined CSP directive values", () => {
      const config: SecurityConfig = {
        csp: {
          "default-src": "'self'",
          "script-src": undefined,
        },
      };
      const result = buildCSP(false, "n4", null, config);
      assertEquals(result, "default-src 'self'");
    });

    it("should prioritize env CSP over cspUserHeader", () => {
      const adapter = createMockAdapter({ VERYFRONT_CSP: "env-csp" });
      const result = buildCSP(false, "n5", "user-csp", null, adapter);
      assertEquals(result, "env-csp");
    });

    it("should prioritize env CSP over config and default", () => {
      const adapter = createMockAdapter({ VERYFRONT_CSP: "env-only" });
      const config: SecurityConfig = { csp: { "default-src": "'none'" } };
      const result = buildCSP(false, "n", "user-header", config, adapter);
      assertEquals(result, "env-only", "env CSP has highest priority");
    });

    it("should prioritize cspUserHeader over config and default", () => {
      const config: SecurityConfig = { csp: { "default-src": "'none'" } };
      const result = buildCSP(false, "n", "user-header", config);
      assertEquals(result, "user-header", "user header takes priority over config");
    });

    it("should use config CSP over default", () => {
      const config: SecurityConfig = { csp: { "default-src": "'none'" } };
      const result = buildCSP(false, "n", null, config);
      assertEquals(result, "default-src 'none'", "config takes priority over default");
      assert(!result.includes("object-src"), "default directives should not leak into config CSP");
    });

    it("should fall through to default when config csp has only undefined values", () => {
      const config: SecurityConfig = {
        csp: { "default-src": undefined, "script-src": undefined },
      };
      const result = buildCSP(false, "n", null, config);
      assert(result.includes("default-src 'self'"), "should fall through to default CSP");
    });

    it("should ignore whitespace-only env CSP", () => {
      const adapter = createMockAdapter({ VERYFRONT_CSP: "   " });
      const result = buildCSP(false, "n", null, null, adapter);
      assert(
        result.includes("default-src 'self'"),
        "whitespace env should fall through to default",
      );
    });

    it("should ignore whitespace-only cspUserHeader", () => {
      const result = buildCSP(false, "n", "   ");
      assert(
        result.includes("default-src 'self'"),
        "whitespace header should fall through to default",
      );
    });

    it("should produce different CSPs for different nonces", () => {
      const a = buildCSP(false, "nonce-aaa", null);
      const b = buildCSP(false, "nonce-bbb", null);
      assert(a !== b, "different nonces should produce different CSPs");
      assert(a.includes("'nonce-nonce-aaa'"), "first nonce embedded");
      assert(b.includes("'nonce-nonce-bbb'"), "second nonce embedded");
    });

    it("default CSP should contain all 11 directives", () => {
      const result = buildCSP(false, "n", null);
      const directives = [
        "default-src",
        "script-src",
        "style-src",
        "img-src",
        "font-src",
        "connect-src",
        "media-src",
        "object-src",
        "frame-src",
        "base-uri",
        "form-action",
      ];
      for (const d of directives) {
        assert(result.includes(d), `default CSP must include ${d}`);
      }
    });

    it("default CSP should not include unsafe-eval", () => {
      const result = buildCSP(false, "n", null);
      assert(!result.includes("unsafe-eval"), "default CSP must not allow eval");
    });

    it("dev mode should return empty even with config present but empty", () => {
      const config: SecurityConfig = { csp: {} };
      const result = buildCSP(true, "n", null, config);
      assertEquals(result, "", "dev mode should return empty CSP");
    });
  });

  describe("getSecurityHeader", () => {
    it("should return default value when no config or env is set", () => {
      const result = getSecurityHeader("COOP", "same-origin");
      assertEquals(result, "same-origin");
    });

    it("should return config value when set", () => {
      const config: SecurityConfig = { coop: "unsafe-none" };
      const result = getSecurityHeader("COOP", "same-origin", config);
      assertEquals(result, "unsafe-none");
    });

    it("should return env value when config is not set", () => {
      const adapter = createMockAdapter({ VERYFRONT_CORP: "cross-origin" });
      const result = getSecurityHeader("CORP", "same-origin", null, adapter);
      assertEquals(result, "cross-origin");
    });

    it("should prioritize config over env", () => {
      const config: SecurityConfig = { corp: "same-site" };
      const adapter = createMockAdapter({ VERYFRONT_CORP: "cross-origin" });
      const result = getSecurityHeader("CORP", "same-origin", config, adapter);
      assertEquals(result, "same-site");
    });
  });

  describe("applySecurityHeaders", () => {
    it("should set X-Content-Type-Options", () => {
      const headers = new Headers();
      applySecurityHeaders(headers, false, "nonce", null);
      assertEquals(headers.get("X-Content-Type-Options"), "nosniff");
    });

    it("should set X-XSS-Protection", () => {
      const headers = new Headers();
      applySecurityHeaders(headers, false, "nonce", null);
      assertEquals(headers.get("X-XSS-Protection"), "1; mode=block");
    });

    it("should set X-Frame-Options to DENY in production", () => {
      const headers = new Headers();
      applySecurityHeaders(headers, false, "nonce", null);
      assertEquals(headers.get("X-Frame-Options"), "DENY");
    });

    it("should not set X-Frame-Options in dev mode", () => {
      const headers = new Headers();
      applySecurityHeaders(headers, true, "nonce", null);
      assertEquals(headers.has("X-Frame-Options"), false);
    });

    it("should not set X-Frame-Options when isVeryfrontDomain is true", () => {
      const headers = new Headers();
      applySecurityHeaders(headers, false, "nonce", null, null, undefined, true);
      assertEquals(headers.has("X-Frame-Options"), false);
    });

    it("should set HSTS in production", () => {
      const headers = new Headers();
      applySecurityHeaders(headers, false, "nonce", null);

      const hsts = headers.get("Strict-Transport-Security");
      assert(hsts !== null);
      assert(hsts.includes("max-age="));
      assert(hsts.includes("includeSubDomains"));
    });

    it("should not set HSTS in dev mode", () => {
      const headers = new Headers();
      applySecurityHeaders(headers, true, "nonce", null);
      assertEquals(headers.has("Strict-Transport-Security"), false);
    });

    it("should set COOP in production", () => {
      const headers = new Headers();
      applySecurityHeaders(headers, false, "nonce", null);
      assertEquals(headers.get("Cross-Origin-Opener-Policy"), "same-origin");
    });

    it("should not set COOP in dev mode", () => {
      const headers = new Headers();
      applySecurityHeaders(headers, true, "nonce", null);
      assertEquals(headers.has("Cross-Origin-Opener-Policy"), false);
    });

    it("should set CORP", () => {
      const headers = new Headers();
      applySecurityHeaders(headers, false, "nonce", null);
      assertEquals(headers.get("Cross-Origin-Resource-Policy"), "same-origin");
    });

    it("should set CSP when cspUserHeader is provided", () => {
      const headers = new Headers();
      applySecurityHeaders(headers, false, "nonce", "default-src 'self'");
      assertEquals(headers.get("Content-Security-Policy"), "default-src 'self'");
    });

    it("should set default CSP in production when no CSP config", () => {
      const headers = new Headers();
      applySecurityHeaders(headers, false, "nonce", null);
      const csp = headers.get("Content-Security-Policy");
      assert(csp !== null, "CSP header must be present in production");
      assert(csp!.includes("default-src 'self'"), "default CSP must include default-src");
      assert(csp!.includes("'nonce-nonce'"), "default CSP must include nonce");
    });

    it("should not set CSP in dev mode when no CSP config", () => {
      const headers = new Headers();
      applySecurityHeaders(headers, true, "nonce", null);
      assertEquals(headers.has("Content-Security-Policy"), false);
    });

    it("should apply extra headers from config", () => {
      const headers = new Headers();
      const config: SecurityConfig = {
        headers: {
          "X-Custom-Header": "custom-value",
        },
      };
      applySecurityHeaders(headers, false, "nonce", null, config);
      assertEquals(headers.get("X-Custom-Header"), "custom-value");
    });

    it("should allow overriding security headers via config.headers", () => {
      const headers = new Headers();
      const config: SecurityConfig = {
        headers: {
          "X-Content-Type-Options": "custom-value",
        },
      };
      applySecurityHeaders(headers, false, "nonce", null, config);
      assertEquals(headers.get("X-Content-Type-Options"), "custom-value");
    });

    it("should set Referrer-Policy to strict-origin-when-cross-origin by default", () => {
      const headers = new Headers();
      applySecurityHeaders(headers, false, "nonce", null);
      assertEquals(headers.get("Referrer-Policy"), "strict-origin-when-cross-origin");
    });

    it("should set Referrer-Policy in dev mode", () => {
      const headers = new Headers();
      applySecurityHeaders(headers, true, "nonce", null);
      assertEquals(headers.get("Referrer-Policy"), "strict-origin-when-cross-origin");
    });

    it("should allow overriding Referrer-Policy via config.headers", () => {
      const headers = new Headers();
      const config: SecurityConfig = {
        headers: {
          "Referrer-Policy": "no-referrer",
        },
      };
      applySecurityHeaders(headers, false, "nonce", null, config);
      assertEquals(headers.get("Referrer-Policy"), "no-referrer");
    });

    it("should use explicit CSP config instead of default", () => {
      const headers = new Headers();
      const config: SecurityConfig = {
        csp: { "default-src": "'none'" },
      };
      applySecurityHeaders(headers, false, "nonce", null, config);
      assertEquals(headers.get("Content-Security-Policy"), "default-src 'none'");
    });

    it("should use env CSP over default", () => {
      const headers = new Headers();
      const adapter = createMockAdapter({ VERYFRONT_CSP: "default-src 'self'" });
      applySecurityHeaders(headers, false, "nonce", null, null, adapter);
      assertEquals(headers.get("Content-Security-Policy"), "default-src 'self'");
    });

    it("default CSP should allow WebSocket connections for HMR", () => {
      const headers = new Headers();
      applySecurityHeaders(headers, false, "nonce", null);
      const csp = headers.get("Content-Security-Policy")!;
      assert(csp.includes("connect-src 'self' wss: https:"), "should allow wss for WebSocket");
    });

    it("default CSP should allow Google Fonts", () => {
      const headers = new Headers();
      applySecurityHeaders(headers, false, "nonce", null);
      const csp = headers.get("Content-Security-Policy")!;
      assert(csp.includes("fonts.googleapis.com"), "should allow Google Fonts styles");
      assert(csp.includes("fonts.gstatic.com"), "should allow Google Fonts files");
    });

    it("default CSP should allow jsdelivr CDN scripts", () => {
      const headers = new Headers();
      applySecurityHeaders(headers, false, "nonce", null);
      const csp = headers.get("Content-Security-Policy")!;
      assert(
        csp.includes("https://cdn.jsdelivr.net"),
        "should allow jsdelivr for Scalar API docs, html2canvas, React UMD",
      );
    });

    it("default CSP should allow veryfront CDN styles and fonts", () => {
      const headers = new Headers();
      applySecurityHeaders(headers, false, "nonce", null);
      const csp = headers.get("Content-Security-Policy")!;
      assert(
        csp.includes("https://cdn.veryfront.com"),
        "should allow veryfront CDN for markdown styles",
      );
    });

    it("default CSP should allow same-origin frames", () => {
      const headers = new Headers();
      applySecurityHeaders(headers, false, "nonce", null);
      const csp = headers.get("Content-Security-Policy")!;
      assert(
        csp.includes("frame-src 'self'"),
        "should allow same-origin iframes by default",
      );
    });

    it("default CSP should include nonce in style-src for migration path", () => {
      const headers = new Headers();
      applySecurityHeaders(headers, false, "my-nonce", null);
      const csp = headers.get("Content-Security-Policy")!;
      assert(
        csp.includes("style-src 'self' 'unsafe-inline' 'nonce-my-nonce'"),
        "style-src should include both unsafe-inline and nonce for migration",
      );
    });

    it("default CSP should block object embeds", () => {
      const headers = new Headers();
      applySecurityHeaders(headers, false, "nonce", null);
      const csp = headers.get("Content-Security-Policy")!;
      assert(csp.includes("object-src 'none'"), "should block plugins/Flash");
    });

    it("default CSP should restrict form-action to self", () => {
      const headers = new Headers();
      applySecurityHeaders(headers, false, "nonce", null);
      const csp = headers.get("Content-Security-Policy")!;
      assert(
        csp.includes("form-action 'self'"),
        "should prevent form submission to external URLs",
      );
    });

    it("custom config with frame-src overrides default frame-src", () => {
      const headers = new Headers();
      const config: SecurityConfig = {
        csp: {
          "default-src": "'self'",
          "frame-src": "'self' https://www.youtube.com https://accounts.google.com",
        },
      };
      applySecurityHeaders(headers, false, "nonce", null, config);
      const csp = headers.get("Content-Security-Policy")!;
      assert(csp.includes("https://www.youtube.com"), "should allow YouTube embeds");
      assert(csp.includes("https://accounts.google.com"), "should allow Google OAuth");
      assert(!csp.includes("object-src"), "custom config replaces entire default");
    });

    it("empty csp config object should fall through to default", () => {
      const headers = new Headers();
      const config: SecurityConfig = { csp: {} };
      applySecurityHeaders(headers, false, "nonce", null, config);
      const csp = headers.get("Content-Security-Policy")!;
      assert(
        csp.includes("default-src 'self'"),
        "empty csp object should use default CSP",
      );
    });

    it("default CSP should place jsdelivr in script-src not style-src", () => {
      const headers = new Headers();
      applySecurityHeaders(headers, false, "nonce", null);
      const csp = headers.get("Content-Security-Policy")!;
      const scriptSrc = csp.split(";").find((d) => d.trim().startsWith("script-src"))!;
      const styleSrc = csp.split(";").find((d) => d.trim().startsWith("style-src"))!;
      assert(
        scriptSrc.includes("cdn.jsdelivr.net"),
        "jsdelivr should be in script-src",
      );
      assert(
        !styleSrc.includes("cdn.jsdelivr.net"),
        "jsdelivr should NOT be in style-src",
      );
    });

    it("default CSP should place veryfront CDN in style-src and font-src", () => {
      const headers = new Headers();
      applySecurityHeaders(headers, false, "nonce", null);
      const csp = headers.get("Content-Security-Policy")!;
      const styleSrc = csp.split(";").find((d) => d.trim().startsWith("style-src"))!;
      const fontSrc = csp.split(";").find((d) => d.trim().startsWith("font-src"))!;
      assert(styleSrc.includes("cdn.veryfront.com"), "veryfront CDN in style-src");
      assert(fontSrc.includes("cdn.veryfront.com"), "veryfront CDN in font-src");
    });

    it("default CSP nonce should match across script-src and style-src", () => {
      const headers = new Headers();
      applySecurityHeaders(headers, false, "unique-nonce-123", null);
      const csp = headers.get("Content-Security-Policy")!;
      const scriptSrc = csp.split(";").find((d) => d.trim().startsWith("script-src"))!;
      const styleSrc = csp.split(";").find((d) => d.trim().startsWith("style-src"))!;
      assert(
        scriptSrc.includes("'nonce-unique-nonce-123'"),
        "script-src should have the nonce",
      );
      assert(
        styleSrc.includes("'nonce-unique-nonce-123'"),
        "style-src should have the same nonce",
      );
    });

    it("default CSP should block http: in connect-src", () => {
      const headers = new Headers();
      applySecurityHeaders(headers, false, "nonce", null);
      const csp = headers.get("Content-Security-Policy")!;
      const connectSrc = csp.split(";").find((d) => d.trim().startsWith("connect-src"))!;
      assert(!connectSrc.includes("http:"), "connect-src must not allow plain http");
    });

    it("config CSP should completely replace default (no directive merging)", () => {
      const headers = new Headers();
      const config: SecurityConfig = {
        csp: { "script-src": "'self'" },
      };
      applySecurityHeaders(headers, false, "nonce", null, config);
      const csp = headers.get("Content-Security-Policy")!;
      assertEquals(csp, "script-src 'self'");
      assert(!csp.includes("default-src"), "default directives must not leak");
      assert(!csp.includes("object-src"), "default directives must not leak");
      assert(!csp.includes("cdn.jsdelivr.net"), "default CDN origins must not leak");
    });

    it("cspUserHeader should completely replace default", () => {
      const headers = new Headers();
      applySecurityHeaders(headers, false, "nonce", "img-src 'none'");
      assertEquals(headers.get("Content-Security-Policy"), "img-src 'none'");
    });
  });
});
