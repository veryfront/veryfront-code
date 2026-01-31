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
    it("should return empty string when no CSP is configured", () => {
      const result = buildCSP(false, "test-nonce", null);
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

    it("should not set CSP when no CSP config", () => {
      const headers = new Headers();
      applySecurityHeaders(headers, false, "nonce", null);
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
  });
});
