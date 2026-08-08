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
import { deriveSecurityContext } from "../config.ts";
import {
  PLATFORM_ASSET_ORIGINS,
  PLATFORM_FONT_FILE_ORIGINS,
  PLATFORM_FONT_STYLE_ORIGINS,
  PLATFORM_IMAGE_ORIGINS,
  PLATFORM_SCRIPT_ORIGINS,
} from "#veryfront/security/http/platform-asset-origins.ts";
import { ESM_CDN_BASE } from "#veryfront/utils/constants/cdn.ts";

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

/**
 * Exact membership in a parsed source list, never substring containment.
 * Matching `https://api.example.com` inside the serialized policy would also
 * pass for a hostile `https://api.example.com.evil.test`, and would pass when
 * the source is present but under some other directive.
 */
function assertAllows(sources: readonly string[], expected: string, msg: string): void {
  assert(new Set(sources).has(expected), `${msg}; got: ${sources.join(" ") || "(none)"}`);
}

function applyHeaders(
  {
    isDev = false,
    nonce = "nonce",
    config = null,
    adapter,
    isVeryfrontDomain,
  }: {
    isDev?: boolean;
    nonce?: string;
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
      const result = buildCSP(false, "test-nonce");
      assert(result.includes("default-src 'self'"), "should have default-src");
      assert(result.includes("'nonce-test-nonce'"), "should include nonce in script-src");
      assert(result.includes("object-src 'none'"), "should block objects");
      assert(result.includes("frame-src 'self'"), "should allow same-origin frames");
      assert(result.includes("base-uri 'self'"), "should restrict base-uri");
    });

    it("applies the floor to a project that configures nothing", () => {
      // Enforcement is not opt-in: hosting means a project that never touches
      // security config still gets a baseline.
      const result = buildCSP(false, "n", null);
      assert(result.includes("script-src"), "floor applies without any config");
      assert(result.includes("object-src 'none'"));
    });

    it("should return empty string in dev mode when no CSP is configured", () => {
      const result = buildCSP(true, "test-nonce");
      assertEquals(result, "");
    });

    it("should use env CSP when set", () => {
      const adapter = createMockAdapter({
        VERYFRONT_CSP: "default-src 'self' 'nonce-{NONCE}'",
      });
      const result = buildCSP(false, "abc123", null, adapter);
      assertEquals(result, "default-src 'self' 'nonce-abc123'");
    });

    it("merges project sources into the floor instead of replacing it", () => {
      // The Google Fonts case: adding a font origin must not cost the project
      // its script policy, which is what replace-semantics used to do.
      const config: SecurityConfig = {
        csp: {
          styleSrc: ["https://fonts.googleapis.com"],
          fontSrc: ["https://fonts.gstatic.com"],
        },
      };
      const result = buildCSP(false, "n1", config);

      assertEquals(parseDirectiveRemoteHosts(result, "font-src"), ["fonts.gstatic.com"]);
      assert(parseDirectiveSources(result, "font-src").includes("'self'"), "floor kept");
      assertAllows(
        parseDirectiveRemoteHosts(result, "style-src"),
        "fonts.googleapis.com",
        "style-src carries the stylesheet origin",
      );
      assert(result.includes("'nonce-n1'"), "script-src floor survives a font addition");
      assert(result.includes("object-src 'none'"), "unrelated floor directives survive");
    });

    it("admits a stylesheet without a competing style-src-elem", () => {
      // style-src-elem duplicated style-src exactly and took precedence for
      // <link>, so a project's styleSrc addition silently failed to load it.
      const result = buildCSP(false, "n", {
        csp: { styleSrc: ["https://fonts.googleapis.com"] },
      });
      assert(!result.includes("style-src-elem"), "no shadowing directive is emitted");
    });

    it("admits the fonts veryfront/fonts emits for a project with no config", () => {
      // GoogleFonts (src/react/fonts/index.ts) writes the googleapis stylesheet
      // and gstatic preconnect into the document itself, so a policy omitting
      // them forbids the same response's own assets. A config-free project used
      // to render in a fallback font with only a console error to show for it.
      const result = buildCSP(false, "n", null);

      assertAllows(
        parseDirectiveRemoteHosts(result, "style-src"),
        "fonts.googleapis.com",
        "the stylesheet the framework links is loadable",
      );
      assertAllows(
        parseDirectiveRemoteHosts(result, "font-src"),
        "fonts.gstatic.com",
        "the font files that stylesheet references are loadable",
      );
    });

    it("lets a project that never calls veryfront/fonts drop the font origins", () => {
      // Baseline, not floor: dropping it can only affect the project's own
      // content, so hardening past the default stays available.
      const result = buildCSP(false, "n", {
        csp: { styleSrc: null, fontSrc: null },
      });

      assertEquals(parseDirectiveRemoteHosts(result, "style-src"), []);
      assertEquals(parseDirectiveRemoteHosts(result, "font-src"), []);
      assert(parseDirectiveSources(result, "style-src").includes("'self'"), "floor survives");
      assert(result.includes("'nonce-n'"), "script-src floor survives");
    });

    it("should handle camelCase and kebab-case directive keys alike", () => {
      const camel = buildCSP(false, "n2", { csp: { fontSrc: ["https://a.example"] } });
      const kebab = buildCSP(false, "n2", { csp: { "font-src": ["https://a.example"] } });
      assertEquals(camel, kebab);
    });

    it("keeps both spellings of one directive instead of dropping either", () => {
      // The two spellings address the same directive, so overwriting would
      // discard a configured origin with no error and no signal.
      const result = buildCSP(false, "n", {
        csp: {
          fontSrc: ["https://a.example"],
          "font-src": ["https://b.example"],
        },
      });
      // Sorted by the helper; fonts.gstatic.com rides along from the baseline.
      assertEquals(parseDirectiveRemoteHosts(result, "font-src"), [
        "a.example",
        "b.example",
        "fonts.gstatic.com",
      ]);
    });

    it("lets null win over the other spelling whichever side it is written on", () => {
      // Order-independent, and the safer of the two readings: a project that
      // spells one directive twice gets the tighter policy, not a coin flip.
      const nullFirst = buildCSP(false, "n", {
        csp: { styleSrc: null, "style-src": ["https://a.example"] },
      });
      const nullLast = buildCSP(false, "n", {
        csp: { "style-src": ["https://a.example"], styleSrc: null },
      });
      assertEquals(nullFirst, nullLast);
      assertEquals(parseDirectiveSources(nullFirst, "style-src"), ["'self'"]);
    });

    it("never resolves a directive key against Object.prototype", () => {
      // Config validation rejects these names, so this guards the builder
      // itself. Keyed on object literals, `constructor` resolved to the Object
      // constructor and spreading it threw, taking down every response; and
      // `merged["__proto__"] = [...]` reset the result's prototype instead of
      // adding a directive.
      const result = buildCSP(false, "n", {
        csp: {
          ["__proto__"]: ["https://evil.example"],
          ["constructor"]: ["https://evil.example"],
        } as unknown as SecurityConfig["csp"],
      });
      assertAllows(
        parseDirectiveSources(result, "default-src"),
        "'self'",
        "the floor is still built and serialized",
      );
      assertEquals(
        (Object.prototype as unknown as Record<string, unknown>)["default-src"],
        undefined,
        "Object.prototype is untouched",
      );
    });

    it("should skip undefined CSP directive values", () => {
      const config: SecurityConfig = {
        csp: { imgSrc: ["https://cdn.example.com"], scriptSrc: undefined },
      };
      const result = buildCSP(false, "n4", config);
      assertAllows(
        parseDirectiveRemoteHosts(result, "img-src"),
        "cdn.example.com",
        "the configured origin is admitted",
      );
      assert(result.includes("'nonce-n4'"), "an undefined value leaves the floor intact");
    });

    it("collapses duplicate sources a project repeats from the floor", () => {
      const result = buildCSP(false, "n", { csp: { fontSrc: ["'self'", "'self'"] } });
      assertEquals(
        parseDirectiveSources(result, "font-src").filter((s) => s === "'self'").length,
        1,
      );
    });

    it("null drops the baseline sources but keeps the required ones", () => {
      // This is how a project hardens past the floor. It must not be able to
      // harden its way into a broken site.
      const result = buildCSP(false, "n", { csp: { styleSrc: null } });
      const sources = parseDirectiveSources(result, "style-src");
      assertEquals(sources, ["'self'"], "'unsafe-inline' dropped, 'self' kept");
      assert(result.includes("'nonce-n'"), "script-src is untouched by a style-src opt-out");
    });

    it("no project config can remove a required origin", () => {
      // Required sources are what the renderer emits; a project that dropped
      // them would only break its own site.
      const attempts: (string[] | null)[] = [null, [], ["'none'"]];
      for (const attempt of attempts) {
        const result = buildCSP(false, "n", { csp: { scriptSrc: attempt } });
        const sources = parseDirectiveSources(result, "script-src");
        assert(sources.includes("'self'"), `'self' survives ${JSON.stringify(attempt)}`);
        assert(sources.includes("'nonce-n'"), `nonce survives ${JSON.stringify(attempt)}`);
        assertAllows(
          parseDirectiveRemoteHosts(result, "script-src"),
          "esm.sh",
          `the ESM CDN survives ${JSON.stringify(attempt)}`,
        );
      }
    });

    it("a project source supersedes a floor of 'none'", () => {
      const result = buildCSP(false, "n", { csp: { objectSrc: ["https://plugin.example"] } });
      const sources = parseDirectiveSources(result, "object-src");
      assert(!sources.includes("'none'"), "'none' is only meaningful alone");
      assertEquals(parseDirectiveRemoteHosts(result, "object-src"), ["plugin.example"]);
    });

    it("should prioritize env CSP over project config", () => {
      const adapter = createMockAdapter({ VERYFRONT_CSP: "env-only" });
      const config: SecurityConfig = { csp: { fontSrc: ["https://a.example"] } };
      const result = buildCSP(false, "n", config, adapter);
      assertEquals(result, "env-only", "env CSP has highest priority");
    });

    it("should ignore whitespace-only env CSP", () => {
      const adapter = createMockAdapter({ VERYFRONT_CSP: "   " });
      const result = buildCSP(false, "n", null, adapter);
      assert(
        result.includes("default-src 'self'"),
        "whitespace env should fall through to the floor",
      );
    });

    it("should produce different CSPs for different nonces", () => {
      const a = buildCSP(false, "nonce-aaa");
      const b = buildCSP(false, "nonce-bbb");
      assert(a !== b, "different nonces should produce different CSPs");
      assert(a.includes("'nonce-nonce-aaa'"), "first nonce embedded");
      assert(b.includes("'nonce-nonce-bbb'"), "second nonce embedded");
    });

    it("default CSP should contain all 14 directives", () => {
      const result = buildCSP(false, "n");
      const directives = [
        "default-src",
        "script-src",
        "style-src",
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
      const result = buildCSP(false, "n", null, undefined, false);
      const sources = parseDirectiveSources(result, "frame-ancestors");
      assertEquals(sources, ["'none'"], "frame-ancestors should be 'none' for customer apps");
    });

    it("default CSP should allow Studio embedding when isVeryfrontDomain is true", () => {
      const result = buildCSP(false, "n", null, undefined, true);
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

    it("default CSP admits no remote hosts beyond the platform's own assets", () => {
      // Narrowed from "no remote hosts at all". That stance could not hold: the
      // renderer emits React from the ESM CDN and images from the platform image
      // service into every document, so a host-free policy blocked the same
      // response's own assets -- no hosted page hydrated and every optimized
      // image was refused. The invariant that still matters is that nothing
      // outside the platform's own origins gets in, and that the directives
      // which grant no benefit from a remote host keep granting none.
      const csp = buildCSP(false, "nonce", null);
      const permitted = new Set<string>(
        PLATFORM_ASSET_ORIGINS.map((origin) => new URL(origin).hostname),
      );
      // Only these carry a platform asset. Every other directive must be
      // exactly host-free, checked by exclusion so a directive added to the
      // policy later is covered here without anyone remembering to list it.
      // connect-src carries the script origins so the browser may fetch the
      // source maps those modules reference. style-src and font-src carry the
      // Google Fonts origins because `veryfront/fonts` emits those tags.
      const mayCarryPlatformHosts = new Set([
        "script-src",
        "img-src",
        "connect-src",
        "style-src",
        "font-src",
      ]);

      for (
        const directive of [
          "default-src",
          "script-src",
          "style-src",
          "img-src",
          "font-src",
          "connect-src",
          "media-src",
          "worker-src",
          "frame-src",
        ]
      ) {
        const hosts = parseDirectiveRemoteHosts(csp, directive);
        if (mayCarryPlatformHosts.has(directive)) {
          assertEquals(
            hosts.filter((host) => !permitted.has(host)),
            [],
            `${directive} must not admit a host outside the platform allowlist`,
          );
          continue;
        }
        assertEquals(
          hosts,
          [],
          `${directive} carries no platform asset and must stay host-free`,
        );
      }

      assertEquals(
        parseDirectiveSources(csp, "connect-src"),
        ["'self'", ...PLATFORM_SCRIPT_ORIGINS],
      );
      assertEquals(parseDirectiveSources(csp, "font-src"), [
        "'self'",
        "data:",
        ...PLATFORM_FONT_FILE_ORIGINS,
      ]);
    });

    it("default CSP admits the platform assets the renderer emits", () => {
      // The failure this pins: the renderer writes these origins into the
      // document and the policy refused them, so React never loaded and every
      // optimized image was blocked.
      const csp = buildCSP(false, "nonce", null);
      assertEquals(
        parseDirectiveRemoteHosts(csp, "script-src"),
        [new URL(ESM_CDN_BASE).hostname],
      );
      assertEquals(
        parseDirectiveRemoteHosts(csp, "img-src"),
        PLATFORM_IMAGE_ORIGINS.map((origin) => new URL(origin).hostname).sort(),
      );
      // Still same-origin and inline data first.
      const imgSources = parseDirectiveSources(csp, "img-src");
      assertEquals(imgSources.includes("'self'"), true);
      assertEquals(imgSources.includes("data:"), true);
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

    it("default CSP should allow inline style elements, blob workers, and blob media", () => {
      const csp = buildCSP(false, "my-nonce", null);
      // style-src governs <style> and <link> because no style-src-elem is
      // emitted to take precedence over it.
      const styleElemSources = parseDirectiveSources(csp, "style-src");
      const mediaSources = parseDirectiveSources(csp, "media-src");
      const workerSources = parseDirectiveSources(csp, "worker-src");
      assert(
        styleElemSources.includes("'unsafe-inline'"),
        "style-src should allow runtime-created style tags",
      );
      assert(
        !styleElemSources.some((source) => source.startsWith("'nonce-")),
        "style-src should not mix a nonce with unsafe-inline because browsers ignore unsafe-inline when nonce/hash sources are present",
      );
      assertEquals(styleElemSources, [
        "'self'",
        "'unsafe-inline'",
        ...PLATFORM_FONT_STYLE_ORIGINS,
      ]);
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

    it("default CSP should not include unsafe-eval", () => {
      const result = buildCSP(false, "n", null);
      assert(!result.includes("unsafe-eval"), "default CSP must not allow eval");
    });

    it("dev mode should return empty even with config present but empty", () => {
      const config: SecurityConfig = { csp: {} };
      const result = buildCSP(true, "n", config);
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
    /**
     * Read the policy whichever header carries it. The floor is served
     * report-only until a project opts in, so tests asserting policy *content*
     * must not also assert the enforcement mode -- that is covered separately.
     */
    const getCsp = (headers: Headers): string | null =>
      headers.get("Content-Security-Policy") ??
        headers.get("Content-Security-Policy-Report-Only");

    it("keeps the canonical policy-owned header list aligned with production output", () => {
      const headers = applyHeaders({
        adapter: createMockAdapter({ VERYFRONT_COEP: "require-corp" }),
      });

      // Exactly one of the two CSP header names is emitted per response, so
      // production output is a subset of the owned list rather than equal to it.
      const emitted = [...headers.keys()].sort();
      const owned = [...SECURITY_POLICY_RESPONSE_HEADER_NAMES];
      for (const name of emitted) {
        assert(owned.includes(name as typeof owned[number]), `${name} must be policy-owned`);
      }
      assertEquals(
        emitted.filter((n) => n.startsWith("content-security-policy")).length,
        1,
        "exactly one CSP header, never both",
      );
      assertEquals(
        owned.filter((n) => !n.startsWith("content-security-policy")).sort(),
        emitted.filter((n) => !n.startsWith("content-security-policy")),
        "every other owned header is emitted",
      );
    });

    it("should set X-Content-Type-Options", () => {
      const headers = applyHeaders();
      assertEquals(headers.get("X-Content-Type-Options"), "nosniff");
    });

    it("should disable the obsolete XSS auditor", () => {
      const headers = applyHeaders();
      assertEquals(headers.get("X-XSS-Protection"), "0");
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
      const csp = getCsp(headers);
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
      const csp = getCsp(headers);
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

    it("should set CSP from an ops-level env override", () => {
      const adapter = createMockAdapter({ VERYFRONT_CSP: "default-src 'self'" });
      const headers = applyHeaders({ adapter });
      assertEquals(headers.get("Content-Security-Policy"), "default-src 'self'");
    });

    it("should set default CSP in production when no CSP config", () => {
      const headers = applyHeaders();
      // Report-only: a project that configured nothing has not opted in.
      assertEquals(
        headers.get("Content-Security-Policy-Report-Only"),
        buildCSP(false, "nonce", null),
      );
      assertEquals(headers.has("Content-Security-Policy"), false);
    });

    it("should not set CSP in dev mode when no CSP config", () => {
      const headers = applyHeaders({ isDev: true });
      assertEquals(headers.has("Content-Security-Policy"), false);
      assertEquals(headers.has("Content-Security-Policy-Report-Only"), false);
    });

    it("enforces the policy once a project declares any csp config", () => {
      // Declaring `security.csp` is the opt-in signal: the project has looked
      // at its own policy, so the floor stops being advisory for it.
      const headers = applyHeaders({ config: { csp: { imgSrc: ["https://cdn.example.com"] } } });
      assertEquals(
        headers.get("Content-Security-Policy"),
        buildCSP(false, "nonce", {
          csp: { imgSrc: ["https://cdn.example.com"] },
        }),
      );
      assertEquals(headers.has("Content-Security-Policy-Report-Only"), false);
    });

    it("treats an empty csp object as an opt-in", () => {
      // The project touched the key, which is the signal -- not how much it put
      // in it. Reading emptiness as "unconfigured" would leave a project that
      // deliberately accepted the floor stuck in report-only forever.
      const headers = applyHeaders({ config: { csp: {} } });
      assertEquals(headers.has("Content-Security-Policy"), true);
      assertEquals(headers.has("Content-Security-Policy-Report-Only"), false);
    });

    it("reports rather than enforces for a project that configures other security keys", () => {
      // `security.cors` is not a CSP opt-in. This is the shape that made the
      // audit ambiguous: a `security` block exists, but no policy was tuned.
      const headers = applyHeaders({ config: { cors: true } });
      assertEquals(headers.has("Content-Security-Policy"), false);
      assert(headers.get("Content-Security-Policy-Report-Only") !== null);
    });

    it("enforces for everyone once VERYFRONT_CSP_ENFORCE is set", () => {
      // The ops lever that ends the staged rollout.
      const adapter = createMockAdapter({ VERYFRONT_CSP_ENFORCE: "1" });
      const headers = applyHeaders({ adapter });
      assertEquals(headers.get("Content-Security-Policy"), buildCSP(false, "nonce", null, adapter));
      assertEquals(headers.has("Content-Security-Policy-Report-Only"), false);
    });

    it("enforces an ops-level VERYFRONT_CSP override even without project opt-in", () => {
      // Writing a whole policy by hand is already an explicit act; serving it
      // report-only would make the override do nothing.
      const adapter = createMockAdapter({ VERYFRONT_CSP: "default-src 'self'" });
      const headers = applyHeaders({ adapter });
      assertEquals(headers.get("Content-Security-Policy"), "default-src 'self'");
      assertEquals(headers.has("Content-Security-Policy-Report-Only"), false);
    });

    it("ignores a project-supplied Content-Security-Policy in security.headers", () => {
      // `security.headers` has no override path for CSP the way Referrer-Policy
      // and X-Frame-Options do, so a value here would silently replace the
      // merged platform floor rather than extend it.
      const headers = applyHeaders({
        config: {
          csp: { imgSrc: ["https://cdn.example.com"] },
          headers: { "Content-Security-Policy": "default-src *" },
        },
      });
      assertEquals(
        headers.get("Content-Security-Policy"),
        buildCSP(false, "nonce", { csp: { imgSrc: ["https://cdn.example.com"] } }),
      );
    });

    it("ignores a project-supplied report-only header, matching case-insensitively", () => {
      // Header names are case-insensitive, and the report-only name is a live
      // delivery mode now -- a project value here could flip which mode is
      // served, not just what it contains.
      const headers = applyHeaders({
        config: { headers: { "Content-Security-Policy-Report-Only": "default-src *" } },
      });
      assertEquals(
        headers.get("Content-Security-Policy-Report-Only"),
        buildCSP(false, "nonce", { headers: {} } as SecurityConfig),
      );
      assertEquals(headers.has("Content-Security-Policy"), false);
    });

    it("still honors the override paths that are meant to exist", () => {
      // Guard against over-correcting: skipping CSP must not disturb the
      // headers `security.headers` is legitimately allowed to set.
      const headers = applyHeaders({
        config: {
          headers: {
            "Content-Security-Policy": "default-src *",
            "Referrer-Policy": "no-referrer",
            "X-Custom": "kept",
          },
        },
      });
      assertEquals(headers.get("Referrer-Policy"), "no-referrer");
      assertEquals(headers.get("X-Custom"), "kept");
    });

    it("merges derived origins between the floor and project config", () => {
      const result = buildCSP(false, "n", {
        derivedCsp: { "img-src": ["https://cdn.derived.example"] },
        csp: { imgSrc: ["https://cdn.configured.example"] },
      } as SecurityConfig);
      const sources = parseDirectiveSources(result, "img-src");
      assertAllows(sources, "https://cdn.derived.example", "derived origin is admitted");
      assertAllows(sources, "https://cdn.configured.example", "configured origin still applies");
      assert(sources.includes("'self'"), "the floor survives");
    });

    it("admits derived origins with no project csp at all", () => {
      // The whole point: a project that configures nothing still loads the
      // assets its own source references.
      const result = buildCSP(false, "n", {
        derivedCsp: { "img-src": ["https://cdn.derived.example"] },
      } as SecurityConfig);
      assertAllows(
        parseDirectiveSources(result, "img-src"),
        "https://cdn.derived.example",
        "derivation alone is enough",
      );
    });

    it("lets an explicit null still drop a directive to the floor", () => {
      // A project that says it wants nothing extra means it. Static analysis
      // must not put back what was just explicitly removed.
      const result = buildCSP(false, "n", {
        derivedCsp: { "font-src": ["https://fonts.derived.example"] },
        csp: { fontSrc: null },
      } as SecurityConfig);
      assertEquals(parseDirectiveRemoteHosts(result, "font-src"), []);
      assert(parseDirectiveSources(result, "font-src").includes("'self'"), "floor survives");
    });

    it("never lets a project author its own derived layer", () => {
      // SecurityConfig has an index signature, so `security.derivedCsp` in a
      // project config would otherwise be copied through and become a second,
      // unaudited way to widen the policy.
      const ctx = deriveSecurityContext(
        { security: { derivedCsp: { "script-src": ["https://evil.example"] } } } as never,
        { productionDefaults: true },
      );
      assertEquals(ctx.securityConfig.derivedCsp, undefined);
      const result = buildCSP(false, "n", ctx.securityConfig);
      assert(
        !parseDirectiveSources(result, "script-src").includes("https://evil.example"),
        "a project-declared derived layer must not reach the policy",
      );
    });

    it("replaces rather than merges a project-declared derived layer", () => {
      const ctx = deriveSecurityContext(
        { security: { derivedCsp: { "img-src": ["https://evil.example"] } } } as never,
        { productionDefaults: true, derivedCsp: { "img-src": ["https://cdn.real.example"] } },
      );
      assertEquals(ctx.securityConfig.derivedCsp, { "img-src": ["https://cdn.real.example"] });
    });

    it("serves the same policy either way, differing only in enforcement", () => {
      // The report-only rollout must not weaken what is reported, or the
      // violations a project sees would not predict what enforcement will do.
      const reported = applyHeaders().get("Content-Security-Policy-Report-Only");
      const enforced = applyHeaders({
        adapter: createMockAdapter({ VERYFRONT_CSP_ENFORCE: "1" }),
      }).get("Content-Security-Policy");
      assertEquals(reported, enforced);
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

      applySecurityHeaders(headers, false, "nonce", config);

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

    it("should merge explicit CSP config into the floor", () => {
      const config: SecurityConfig = {
        csp: { imgSrc: ["https://cdn.example.com"] },
      };
      const headers = applyHeaders({ config });
      assertEquals(
        headers.get("Content-Security-Policy"),
        buildCSP(false, "nonce", config),
      );
    });

    it("should use env CSP over default", () => {
      const adapter = createMockAdapter({ VERYFRONT_CSP: "default-src 'self'" });
      const headers = applyHeaders({ adapter });
      assertEquals(
        headers.get("Content-Security-Policy"),
        buildCSP(false, "nonce", null, adapter),
      );
    });

    it("custom config with frame-src extends the default frame-src", () => {
      const config: SecurityConfig = {
        csp: {
          frameSrc: ["https://www.youtube.com", "https://accounts.google.com"],
        },
      };
      const headers = applyHeaders({ config });
      assertEquals(
        headers.get("Content-Security-Policy"),
        buildCSP(false, "nonce", config),
      );
      const csp = headers.get("Content-Security-Policy") ?? "";
      assert(
        parseDirectiveSources(csp, "frame-src").includes("'self'"),
        "the floor's own frame-src survives the addition",
      );
    });

    it("empty csp config object should fall through to default", () => {
      const config: SecurityConfig = { csp: {} };
      const headers = applyHeaders({ config });
      assertEquals(
        headers.get("Content-Security-Policy"),
        buildCSP(false, "nonce", config),
      );
    });

    it("project config takes effect at all", () => {
      // Regression guard: project CSP once reached buildCSP by two routes and
      // the earlier one shadowed the merge, so a correct merge could still be
      // a no-op in production while every other assertion here passed.
      const config: SecurityConfig = { csp: { connectSrc: ["https://api.example.com"] } };
      const headers = applyHeaders({ config });
      assertAllows(
        parseDirectiveSources(headers.get("Content-Security-Policy") ?? "", "connect-src"),
        "https://api.example.com",
        "a configured source must reach the served header",
      );
    });
  });
});
