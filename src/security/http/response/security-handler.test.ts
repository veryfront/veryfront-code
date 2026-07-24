import "#veryfront/schemas/_test-setup.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import {
  applySecurityHeaders,
  buildCSP,
  generateNonce,
  getSecurityHeader,
  SECURITY_POLICY_RESPONSE_HEADER_NAMES,
} from "./security-handler.ts";
import type { SecurityConfig } from "./types.ts";

function createMockAdapter(
  envMap: Record<string, string> = {},
): RuntimeAdapter {
  return {
    env: {
      get(key: string) {
        return envMap[key];
      },
    },
  } as RuntimeAdapter;
}

function parseDirectiveSources(csp: string, directiveName: string): string[] {
  const directive = csp
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${directiveName} `));

  if (!directive) return [];
  return directive.split(/\s+/).slice(1);
}

function parseDirectiveRemoteHosts(csp: string, directiveName: string): string[] {
  return parseDirectiveSources(csp, directiveName)
    .flatMap((source) => {
      try {
        const url = new URL(source);
        if (url.protocol === "https:" && url.hostname) {
          return [url.hostname];
        }
      } catch {
        // Ignore non-URL CSP tokens such as keywords, schemes, and nonces.
      }
      return [];
    })
    .sort();
}

function applyHeaders(
  {
    isDev = false,
    nonce = "nonce",
    cspUserHeader = null,
    config = null,
    adapter,
    isVeryfrontDomain,
  }: {
    isDev?: boolean;
    nonce?: string;
    cspUserHeader?: string | null;
    config?: SecurityConfig | null;
    adapter?: RuntimeAdapter;
    isVeryfrontDomain?: boolean;
  } = {},
): Headers {
  const headers = new Headers();
  applySecurityHeaders(
    headers,
    isDev,
    nonce,
    cspUserHeader,
    config,
    adapter,
    isVeryfrontDomain,
  );
  return headers;
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
      const defaultSources = parseDirectiveSources(result, "default-src");
      const defaultHosts = parseDirectiveRemoteHosts(result, "default-src");
      assert(defaultSources.includes("'self'"));
      assertEquals(defaultHosts, ["cdn.example.com"]);
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

    it("default CSP should contain all 15 directives", () => {
      const result = buildCSP(false, "n", null);
      const directives = [
        "default-src",
        "script-src",
        "style-src",
        "style-src-elem",
        "style-src-attr",
        "img-src",
        "font-src",
        "connect-src",
        "media-src",
        "worker-src",
        "object-src",
        "frame-src",
        "frame-ancestors",
        "base-uri",
        "form-action",
      ];
      for (const d of directives) {
        assert(result.includes(d), `default CSP must include ${d}`);
      }
    });

    it("default CSP should set frame-ancestors 'none' for non-veryfront domains", () => {
      const result = buildCSP(false, "n", null, null, undefined, false);
      const sources = parseDirectiveSources(result, "frame-ancestors");
      assertEquals(sources, ["'none'"], "frame-ancestors should be 'none' for customer apps");
    });

    it("default CSP should allow Studio embedding when isVeryfrontDomain is true", () => {
      const result = buildCSP(false, "n", null, null, undefined, true);
      const sources = parseDirectiveSources(result, "frame-ancestors");
      // Only explicit Studio hosts — no wildcards. Tenant project domains
      // (`{slug}.preview.veryfront.com` etc.) must NOT be able to embed
      // each other (tenant-vs-tenant clickjacking).
      assertEquals(
        sources,
        [
          "'self'",
          "https://veryfront.com",
          "https://veryfront.org",
        ],
        "frame-ancestors must be the explicit Studio allowlist",
      );
      assert(
        !sources.some((s) => s.includes("*")),
        "frame-ancestors must not include wildcard host patterns",
      );
    });

    it("default CSP should allow WebSocket connections for HMR", () => {
      const connectSources = parseDirectiveSources(buildCSP(false, "nonce", null), "connect-src");
      assert(connectSources.includes("wss:"), "should allow wss for WebSocket");
      assert(connectSources.includes("https:"), "should allow https for fetch/XHR");
    });

    it("default CSP should allow Google Fonts", () => {
      const csp = buildCSP(false, "nonce", null);
      const styleHosts = parseDirectiveRemoteHosts(csp, "style-src");
      const fontHosts = parseDirectiveRemoteHosts(csp, "font-src");
      assertEquals(
        styleHosts.filter((host) => host === "fonts.googleapis.com"),
        ["fonts.googleapis.com"],
        "should allow Google Fonts styles",
      );
      assertEquals(
        fontHosts.filter((host) => host === "fonts.gstatic.com"),
        ["fonts.gstatic.com"],
        "should allow Google Fonts files",
      );
    });

    it("default CSP should allow jsdelivr CDN scripts", () => {
      const scriptHosts = parseDirectiveRemoteHosts(buildCSP(false, "nonce", null), "script-src");
      assertEquals(
        scriptHosts.filter((host) => host === "cdn.jsdelivr.net"),
        ["cdn.jsdelivr.net"],
        "should allow jsdelivr for Scalar API docs, html2canvas, React UMD",
      );
    });

    it("default CSP should allow esm.sh scripts for browser ESM hydration", () => {
      const scriptHosts = parseDirectiveRemoteHosts(buildCSP(false, "nonce", null), "script-src");
      assertEquals(
        scriptHosts.filter((host) => host === "esm.sh"),
        ["esm.sh"],
        "should allow esm.sh for the pages-router/browser ESM hydration path",
      );
    });

    it("default CSP should allow veryfront CDN styles and fonts", () => {
      const csp = buildCSP(false, "nonce", null);
      const styleHosts = parseDirectiveRemoteHosts(csp, "style-src");
      const fontHosts = parseDirectiveRemoteHosts(csp, "font-src");
      assertEquals(
        styleHosts.filter((host) => host === "cdn.veryfront.com"),
        ["cdn.veryfront.com"],
        "veryfront CDN in style-src",
      );
      assertEquals(
        fontHosts.filter((host) => host === "cdn.veryfront.com"),
        ["cdn.veryfront.com"],
        "veryfront CDN in font-src",
      );
    });

    it("default CSP should allow same-origin frames", () => {
      const frameSources = parseDirectiveSources(buildCSP(false, "nonce", null), "frame-src");
      assert(frameSources.includes("'self'"), "should allow same-origin iframes by default");
    });

    it("default CSP should allow inline styles without adding a style nonce", () => {
      const styleSources = parseDirectiveSources(buildCSP(false, "my-nonce", null), "style-src");
      assert(
        styleSources.includes("'unsafe-inline'"),
        "style-src should keep unsafe-inline for framework and app inline styles",
      );
      assert(
        !styleSources.some((source) => source.startsWith("'nonce-")),
        "style-src should not include a nonce because that disables unsafe-inline in browsers",
      );
    });

    it("default CSP should allow inline style attributes via style-src-attr", () => {
      const styleAttrSources = parseDirectiveSources(
        buildCSP(false, "my-nonce", null),
        "style-src-attr",
      );
      assert(
        styleAttrSources.includes("'unsafe-inline'"),
        "style-src-attr should explicitly allow React style attributes",
      );
    });

    it("default CSP should allow Video.js stylesheet, style elements, blob workers, and blob media", () => {
      const csp = buildCSP(false, "my-nonce", null);
      const styleElemSources = parseDirectiveSources(
        csp,
        "style-src-elem",
      );
      const mediaSources = parseDirectiveSources(csp, "media-src");
      const workerSources = parseDirectiveSources(csp, "worker-src");
      const remoteStyleElemHosts = parseDirectiveRemoteHosts(
        csp,
        "style-src-elem",
      );
      assert(
        styleElemSources.includes("'unsafe-inline'"),
        "style-src-elem should allow runtime-created style tags",
      );
      assert(
        !styleElemSources.some((source) => source.startsWith("'nonce-")),
        "style-src-elem should not mix a nonce with unsafe-inline because browsers ignore unsafe-inline when nonce/hash sources are present",
      );
      assertEquals(
        remoteStyleElemHosts,
        ["cdn.veryfront.com", "fonts.googleapis.com", "vjs.zencdn.net"],
        "style-src-elem should allow Google Fonts, Veryfront CDN, and the Video.js stylesheet CDN",
      );
      assert(
        mediaSources.includes("blob:"),
        "media-src should allow blob media URLs generated by browser media pipelines",
      );
      assertEquals(
        workerSources,
        ["'self'", "blob:"],
        "worker-src should allow same-origin and blob workers without broadening script-src",
      );
    });

    it("default CSP should block object embeds", () => {
      const objectSources = parseDirectiveSources(buildCSP(false, "nonce", null), "object-src");
      assert(objectSources.includes("'none'"), "should block plugins/Flash");
    });

    it("default CSP should restrict form-action to self", () => {
      const formActionSources = parseDirectiveSources(
        buildCSP(false, "nonce", null),
        "form-action",
      );
      assert(
        formActionSources.includes("'self'"),
        "should prevent form submission to external URLs",
      );
    });

    it("default CSP should place jsdelivr in script-src not style-src", () => {
      const csp = buildCSP(false, "nonce", null);
      const scriptHosts = parseDirectiveRemoteHosts(csp, "script-src");
      const styleHosts = parseDirectiveRemoteHosts(csp, "style-src");
      assertEquals(
        scriptHosts.filter((host) => host === "cdn.jsdelivr.net"),
        ["cdn.jsdelivr.net"],
        "jsdelivr should be in script-src",
      );
      assertEquals(
        styleHosts.filter((host) => host === "cdn.jsdelivr.net"),
        [],
        "jsdelivr should NOT be in style-src",
      );
    });

    it("default CSP should place esm.sh in script-src not style-src", () => {
      const csp = buildCSP(false, "nonce", null);
      const scriptHosts = parseDirectiveRemoteHosts(csp, "script-src");
      const styleHosts = parseDirectiveRemoteHosts(csp, "style-src");
      assertEquals(
        scriptHosts.filter((host) => host === "esm.sh"),
        ["esm.sh"],
        "esm.sh should be in script-src",
      );
      assertEquals(
        styleHosts.filter((host) => host === "esm.sh"),
        [],
        "esm.sh should NOT be in style-src",
      );
    });

    it("default CSP should keep the nonce on script-src but not on style-src", () => {
      const csp = buildCSP(false, "unique-nonce-123", null);
      const scriptSources = parseDirectiveSources(csp, "script-src");
      const styleSources = parseDirectiveSources(csp, "style-src");
      assert(
        scriptSources.includes("'nonce-unique-nonce-123'"),
        "script-src should have the nonce",
      );
      assert(
        !styleSources.includes("'nonce-unique-nonce-123'"),
        "style-src should omit the nonce so unsafe-inline remains effective",
      );
    });

    it("default CSP should block http: in connect-src", () => {
      const connectSources = parseDirectiveSources(buildCSP(false, "nonce", null), "connect-src");
      assert(!connectSources.includes("http:"), "connect-src must not allow plain http");
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
    it("keeps the canonical policy-owned header list aligned with production output", () => {
      const headers = applyHeaders({
        adapter: createMockAdapter({ VERYFRONT_COEP: "require-corp" }),
      });

      assertEquals(
        [...headers.keys()].sort(),
        [...SECURITY_POLICY_RESPONSE_HEADER_NAMES].sort(),
      );
    });

    it("should set X-Content-Type-Options", () => {
      const headers = applyHeaders();
      assertEquals(headers.get("X-Content-Type-Options"), "nosniff");
    });

    it("should set X-XSS-Protection", () => {
      const headers = applyHeaders();
      assertEquals(headers.get("X-XSS-Protection"), "1; mode=block");
    });

    it("should set X-Frame-Options to DENY in production", () => {
      const headers = applyHeaders();
      assertEquals(headers.get("X-Frame-Options"), "DENY");
    });

    it("should not set X-Frame-Options in dev mode", () => {
      const headers = applyHeaders({ isDev: true });
      assertEquals(headers.has("X-Frame-Options"), false);
    });

    it("should set X-Frame-Options DENY even when isVeryfrontDomain is true (SEC-007)", () => {
      // Legacy clickjacking control. Modern browsers ignore X-Frame-Options
      // when frame-ancestors is set (which it is for veryfront-hosted apps),
      // so DENY here is a safe fallback that still permits Studio embedding
      // in modern browsers via the CSP allowlist.
      const headers = applyHeaders({ isVeryfrontDomain: true });
      assertEquals(headers.get("X-Frame-Options"), "DENY");
    });

    it("should set CSP frame-ancestors with veryfront origins when isVeryfrontDomain is true (SEC-007)", () => {
      const headers = applyHeaders({ isVeryfrontDomain: true });
      const csp = headers.get("Content-Security-Policy");
      assert(csp !== null, "CSP header should be present");
      const frameAncestors = parseDirectiveSources(csp, "frame-ancestors");
      assertEquals(
        frameAncestors,
        [
          "'self'",
          "https://veryfront.com",
          "https://veryfront.org",
        ],
        "frame-ancestors must be the explicit Studio allowlist (no wildcards, no tenant subdomains)",
      );
    });

    it("should set CSP frame-ancestors 'none' for non-veryfront domains (SEC-007)", () => {
      const headers = applyHeaders({ isVeryfrontDomain: false });
      const csp = headers.get("Content-Security-Policy");
      assert(csp !== null, "CSP header should be present");
      assert(
        csp.includes("frame-ancestors 'none'"),
        "frame-ancestors should be 'none' for customer apps",
      );
    });

    it("should set HSTS in production", () => {
      const headers = applyHeaders();

      const hsts = headers.get("Strict-Transport-Security");
      assert(hsts !== null);
      assert(hsts.includes("max-age="));
      assert(hsts.includes("includeSubDomains"));
    });

    it("should not set HSTS in dev mode", () => {
      const headers = applyHeaders({ isDev: true });
      assertEquals(headers.has("Strict-Transport-Security"), false);
    });

    it("should set COOP in production", () => {
      const headers = applyHeaders();
      assertEquals(headers.get("Cross-Origin-Opener-Policy"), "same-origin");
    });

    it("should not set COOP in dev mode", () => {
      const headers = applyHeaders({ isDev: true });
      assertEquals(headers.has("Cross-Origin-Opener-Policy"), false);
    });

    it("should set CORP", () => {
      const headers = applyHeaders();
      assertEquals(headers.get("Cross-Origin-Resource-Policy"), "same-origin");
    });

    it("should set CSP when cspUserHeader is provided", () => {
      const headers = applyHeaders({ cspUserHeader: "default-src 'self'" });
      assertEquals(headers.get("Content-Security-Policy"), "default-src 'self'");
    });

    it("should set default CSP in production when no CSP config", () => {
      const headers = applyHeaders();
      assertEquals(headers.get("Content-Security-Policy"), buildCSP(false, "nonce", null));
    });

    it("should not set CSP in dev mode when no CSP config", () => {
      const headers = applyHeaders({ isDev: true });
      assertEquals(headers.has("Content-Security-Policy"), false);
    });

    it("should apply extra headers from config", () => {
      const config: SecurityConfig = {
        headers: {
          "X-Custom-Header": "custom-value",
        },
      };
      const headers = applyHeaders({ config });
      assertEquals(headers.get("X-Custom-Header"), "custom-value");
    });

    it("keeps Access-Control-* headers authoritative to the CORS policy layer", () => {
      const config: SecurityConfig = {
        headers: {
          "X-Custom-Header": "custom-value",
          "Access-Control-Allow-Origin": "*",
          "aCcEsS-CoNtRoL-AlLoW-CrEdEnTiAlS": "true",
          "Access-Control-Future-Policy": "unsafe",
        },
      };
      const headers = new Headers({
        "Access-Control-Allow-Origin": "https://policy.example",
      });

      applySecurityHeaders(headers, false, "nonce", null, config);

      assertEquals(headers.get("X-Custom-Header"), "custom-value");
      assertEquals(
        headers.get("Access-Control-Allow-Origin"),
        "https://policy.example",
      );
      assertEquals(headers.get("Access-Control-Allow-Credentials"), null);
      assertEquals(headers.get("Access-Control-Future-Policy"), null);
    });

    it("should allow overriding security headers via config.headers", () => {
      const config: SecurityConfig = {
        headers: {
          "X-Content-Type-Options": "custom-value",
        },
      };
      const headers = applyHeaders({ config });
      assertEquals(headers.get("X-Content-Type-Options"), "custom-value");
    });

    it("should set Referrer-Policy to strict-origin-when-cross-origin by default", () => {
      const headers = applyHeaders();
      assertEquals(headers.get("Referrer-Policy"), "strict-origin-when-cross-origin");
    });

    it("should set Referrer-Policy in dev mode", () => {
      const headers = applyHeaders({ isDev: true });
      assertEquals(headers.get("Referrer-Policy"), "strict-origin-when-cross-origin");
    });

    it("should allow overriding Referrer-Policy via config.headers", () => {
      const config: SecurityConfig = {
        headers: {
          "Referrer-Policy": "no-referrer",
        },
      };
      const headers = applyHeaders({ config });
      assertEquals(headers.get("Referrer-Policy"), "no-referrer");
    });

    it("should use explicit CSP config instead of default", () => {
      const config: SecurityConfig = {
        csp: { "default-src": "'none'" },
      };
      const headers = applyHeaders({ config });
      assertEquals(
        headers.get("Content-Security-Policy"),
        buildCSP(false, "nonce", null, config),
      );
    });

    it("should use env CSP over default", () => {
      const adapter = createMockAdapter({ VERYFRONT_CSP: "default-src 'self'" });
      const headers = applyHeaders({ adapter });
      assertEquals(
        headers.get("Content-Security-Policy"),
        buildCSP(false, "nonce", null, null, adapter),
      );
    });

    it("custom config with frame-src overrides default frame-src", () => {
      const config: SecurityConfig = {
        csp: {
          "default-src": "'self'",
          "frame-src": "'self' https://www.youtube.com https://accounts.google.com",
        },
      };
      const headers = applyHeaders({ config });
      assertEquals(
        headers.get("Content-Security-Policy"),
        buildCSP(false, "nonce", null, config),
      );
    });

    it("empty csp config object should fall through to default", () => {
      const config: SecurityConfig = { csp: {} };
      const headers = applyHeaders({ config });
      assertEquals(
        headers.get("Content-Security-Policy"),
        buildCSP(false, "nonce", null, config),
      );
    });

    it("config CSP should completely replace default (no directive merging)", () => {
      const config: SecurityConfig = {
        csp: { "script-src": "'self'" },
      };
      const headers = applyHeaders({ config });
      assertEquals(
        headers.get("Content-Security-Policy"),
        buildCSP(false, "nonce", null, config),
      );
    });

    it("cspUserHeader should completely replace default", () => {
      const headers = applyHeaders({ cspUserHeader: "img-src 'none'" });
      assertEquals(
        headers.get("Content-Security-Policy"),
        buildCSP(false, "nonce", "img-src 'none'"),
      );
    });
  });
});
