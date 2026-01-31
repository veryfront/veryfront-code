/** @module transforms/esm/http-cache-utils.test
 *
 * Unit tests for pure-logic helpers in http-cache.ts.
 * Tests are written against local duplicates of non-exported functions
 * to avoid triggering module-level side effects (cache backends, etc.).
 */

import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

// ──────────────────────────────────────────────────────────────
// Pure-logic duplicates from http-cache.ts for isolated testing
// ──────────────────────────────────────────────────────────────

function distributedKey(prefix: string, hash: string | number): string {
  return `${prefix}:${hash}`;
}

function hasIncompatibleFilePaths(code: string, localCacheDir: string): boolean {
  const filePathPattern = /file:\/\/([^"'\s]+)/gi;

  let match: RegExpExecArray | null;
  while ((match = filePathPattern.exec(code)) !== null) {
    const path = match[1];
    if (!path.includes("veryfront-http-bundle")) continue;
    if (!path.startsWith(localCacheDir)) return true;
  }

  return false;
}

function ensureAbsoluteDir(path: string): string {
  // Simplified: in source uses isAbsolute + join(cwd())
  return path.startsWith("/") ? path : `/cwd/${path}`;
}

function isHttpUrl(specifier: string): boolean {
  return specifier.startsWith("https://") || specifier.startsWith("http://");
}

function isReactCoreUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.includes("esm.sh")) return false;

    const pathname = parsed.pathname.replace(/^\/(v\d+|stable)\//, "/");
    return /^\/(react|react-dom)(@[\d.]+)?(?:\/|$|\?)/.test(pathname);
  } catch {
    return false;
  }
}

function isExternalScheme(specifier: string): boolean {
  return specifier.startsWith("node:") ||
    specifier.startsWith("data:") ||
    specifier.startsWith("file:") ||
    specifier.startsWith("bun:");
}

function isRelative(specifier: string): boolean {
  return specifier.startsWith("./") || specifier.startsWith("../") || specifier.startsWith("/");
}

function isInternalBare(specifier: string): boolean {
  return specifier.startsWith("veryfront/") ||
    specifier.startsWith("@veryfront/") ||
    specifier.startsWith("#veryfront/") ||
    specifier.startsWith("@std/") ||
    specifier.startsWith("_vf_modules/") ||
    specifier.startsWith("/_vf_modules/");
}

function normalizeEsmShUrl(url: URL): void {
  if (url.hostname !== "esm.sh") return;

  if (url.pathname.includes("/denonext/")) {
    url.pathname = url.pathname.replace("/denonext/", "/");
  }

  if (!url.searchParams.has("target")) {
    url.searchParams.set("target", "es2022");
  }

  const pathname = url.pathname.replace(/^\/+/, "");
  if (/^react@[\d.]+(?:\?|$)/.test(pathname)) return;

  const existing = url.searchParams.get("external");
  const externals = existing ? existing.split(",") : [];

  if (!externals.includes("react")) {
    externals.push("react");
    url.searchParams.set("external", externals.join(","));
  }
}

function normalizeHttpUrl(raw: string): string {
  try {
    const url = new URL(raw);
    normalizeEsmShUrl(url);
    url.searchParams.sort();
    return url.toString();
  } catch {
    return raw;
  }
}

// ──────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────

describe("http-cache utilities", { sanitizeResources: false, sanitizeOps: false }, () => {
  // ── distributedKey ──
  describe("distributedKey", () => {
    it("creates prefix:hash format with string hash", () => {
      assertEquals(distributedKey("url", "abc123"), "url:abc123");
    });

    it("creates prefix:hash format with numeric hash", () => {
      assertEquals(distributedKey("code", 12345), "code:12345");
    });

    it("works with all known prefixes", () => {
      assertEquals(distributedKey("url", "h"), "url:h");
      assertEquals(distributedKey("code", "h"), "code:h");
      assertEquals(distributedKey("hash", "h"), "hash:h");
    });
  });

  // ── hasIncompatibleFilePaths ──
  describe("hasIncompatibleFilePaths", () => {
    it("returns false when no file:// paths", () => {
      assertEquals(hasIncompatibleFilePaths("const x = 1;", "/local/cache"), false);
    });

    it("returns false when paths match local cache dir", () => {
      const code = `import f from "file:///local/cache/veryfront-http-bundle/http-123.mjs"`;
      assertEquals(hasIncompatibleFilePaths(code, "/local/cache/veryfront-http-bundle"), false);
    });

    it("returns true when paths from different environment", () => {
      const code = `import f from "file:///app/.cache/veryfront-http-bundle/http-123.mjs"`;
      assertEquals(hasIncompatibleFilePaths(code, "/local/cache/veryfront-http-bundle"), true);
    });

    it("ignores non-bundle file:// paths", () => {
      const code = `import f from "file:///some/other/path.mjs"`;
      assertEquals(hasIncompatibleFilePaths(code, "/local/cache"), false);
    });

    it("detects first incompatible path among multiple", () => {
      const code = [
        `import a from "file:///local/cache/veryfront-http-bundle/http-aaa.mjs";`,
        `import b from "file:///app/.cache/veryfront-http-bundle/http-bbb.mjs";`,
      ].join("\n");
      assertEquals(hasIncompatibleFilePaths(code, "/local/cache/veryfront-http-bundle"), true);
    });

    it("handles concurrent calls safely (new regex per call)", () => {
      const code1 = `import f from "file:///app/veryfront-http-bundle/http-1.mjs"`;
      const code2 = `import f from "file:///app/veryfront-http-bundle/http-2.mjs"`;
      // Both should return true (different local dir)
      assertEquals(hasIncompatibleFilePaths(code1, "/local"), true);
      assertEquals(hasIncompatibleFilePaths(code2, "/local"), true);
    });
  });

  // ── ensureAbsoluteDir ──
  describe("ensureAbsoluteDir", () => {
    it("returns absolute path unchanged", () => {
      assertEquals(ensureAbsoluteDir("/absolute/path"), "/absolute/path");
    });

    it("prefixes relative path with cwd", () => {
      const result = ensureAbsoluteDir("relative/path");
      assert(result.startsWith("/"));
      assert(result.includes("relative/path"));
    });
  });

  // ── isHttpUrl ──
  describe("isHttpUrl", () => {
    it("recognizes https URLs", () => {
      assertEquals(isHttpUrl("https://esm.sh/react"), true);
    });

    it("recognizes http URLs", () => {
      assertEquals(isHttpUrl("http://localhost:3000"), true);
    });

    it("rejects non-http URLs", () => {
      assertEquals(isHttpUrl("file:///path"), false);
      assertEquals(isHttpUrl("node:fs"), false);
      assertEquals(isHttpUrl("react"), false);
      assertEquals(isHttpUrl("./relative"), false);
    });
  });

  // ── isReactCoreUrl ──
  describe("isReactCoreUrl", () => {
    it("matches react on esm.sh", () => {
      assertEquals(isReactCoreUrl("https://esm.sh/react@18.3.1"), true);
    });

    it("matches react-dom on esm.sh", () => {
      assertEquals(isReactCoreUrl("https://esm.sh/react-dom@18.3.1"), true);
    });

    it("matches versioned paths like /v150/react@18", () => {
      assertEquals(isReactCoreUrl("https://esm.sh/v150/react@18.3.1"), true);
    });

    it("matches /stable/ prefix", () => {
      assertEquals(isReactCoreUrl("https://esm.sh/stable/react@18.3.1"), true);
    });

    it("matches react with subpath", () => {
      assertEquals(isReactCoreUrl("https://esm.sh/react@18.3.1/jsx-runtime"), true);
    });

    it("rejects non-esm.sh URLs", () => {
      assertEquals(isReactCoreUrl("https://cdn.example.com/react@18"), false);
    });

    it("rejects non-React packages on esm.sh", () => {
      assertEquals(isReactCoreUrl("https://esm.sh/lodash@4.17.21"), false);
    });

    it("rejects packages that start with react but are different", () => {
      // "react-query" should not match (pattern requires exact react or react-dom)
      assertEquals(isReactCoreUrl("https://esm.sh/react-query@3.0.0"), false);
    });

    it("handles invalid URLs", () => {
      assertEquals(isReactCoreUrl("not-a-url"), false);
    });
  });

  // ── isExternalScheme ──
  describe("isExternalScheme", () => {
    it("detects node: scheme", () => {
      assertEquals(isExternalScheme("node:fs"), true);
    });

    it("detects data: scheme", () => {
      assertEquals(isExternalScheme("data:text/plain"), true);
    });

    it("detects file: scheme", () => {
      assertEquals(isExternalScheme("file:///path"), true);
    });

    it("detects bun: scheme", () => {
      assertEquals(isExternalScheme("bun:test"), true);
    });

    it("rejects http/https", () => {
      assertEquals(isExternalScheme("https://example.com"), false);
      assertEquals(isExternalScheme("http://example.com"), false);
    });

    it("rejects bare specifiers", () => {
      assertEquals(isExternalScheme("react"), false);
      assertEquals(isExternalScheme("lodash/fp"), false);
    });
  });

  // ── isRelative ──
  describe("isRelative", () => {
    it("detects ./ paths", () => {
      assertEquals(isRelative("./utils.js"), true);
    });

    it("detects ../ paths", () => {
      assertEquals(isRelative("../lib/foo.js"), true);
    });

    it("detects / absolute paths", () => {
      assertEquals(isRelative("/root/path.js"), true);
    });

    it("rejects bare specifiers", () => {
      assertEquals(isRelative("react"), false);
      assertEquals(isRelative("lodash"), false);
    });

    it("rejects URLs", () => {
      assertEquals(isRelative("https://example.com"), false);
    });
  });

  // ── isInternalBare ──
  describe("isInternalBare", () => {
    it("detects veryfront/ specifiers", () => {
      assertEquals(isInternalBare("veryfront/head"), true);
    });

    it("detects @veryfront/ specifiers", () => {
      assertEquals(isInternalBare("@veryfront/utils"), true);
    });

    it("detects @std/ specifiers", () => {
      assertEquals(isInternalBare("@std/path"), true);
    });

    it("rejects other specifiers", () => {
      assertEquals(isInternalBare("react"), false);
      assertEquals(isInternalBare("lodash"), false);
      assertEquals(isInternalBare("@scope/package"), false);
    });
  });

  // ── normalizeEsmShUrl ──
  describe("normalizeEsmShUrl", () => {
    it("removes /denonext/ from pathname", () => {
      const url = new URL("https://esm.sh/denonext/lodash@4.17.21");
      normalizeEsmShUrl(url);
      assertEquals(url.pathname.includes("denonext"), false);
    });

    it("adds target=es2022 when missing", () => {
      const url = new URL("https://esm.sh/lodash@4.17.21");
      normalizeEsmShUrl(url);
      assertEquals(url.searchParams.get("target"), "es2022");
    });

    it("preserves existing target parameter", () => {
      const url = new URL("https://esm.sh/lodash@4.17.21?target=es2020");
      normalizeEsmShUrl(url);
      assertEquals(url.searchParams.get("target"), "es2020");
    });

    it("adds external=react for non-React packages", () => {
      const url = new URL("https://esm.sh/lodash@4.17.21");
      normalizeEsmShUrl(url);
      const ext = url.searchParams.get("external");
      assert(ext !== null && ext.includes("react"));
    });

    it("does not add external=react for base react package", () => {
      const url = new URL("https://esm.sh/react@18.3.1");
      normalizeEsmShUrl(url);
      assertEquals(url.searchParams.get("external"), null);
    });

    it("appends react to existing externals", () => {
      const url = new URL("https://esm.sh/some-pkg@1.0?external=preact");
      normalizeEsmShUrl(url);
      const ext = url.searchParams.get("external")!;
      assert(ext.includes("preact"));
      assert(ext.includes("react"));
    });

    it("does not duplicate react in externals", () => {
      const url = new URL("https://esm.sh/some-pkg@1.0?external=react");
      normalizeEsmShUrl(url);
      assertEquals(url.searchParams.get("external"), "react");
    });

    it("is a no-op for non-esm.sh URLs", () => {
      const url = new URL("https://cdn.example.com/pkg@1.0");
      const before = url.toString();
      normalizeEsmShUrl(url);
      assertEquals(url.toString(), before);
    });
  });

  // ── normalizeHttpUrl ──
  describe("normalizeHttpUrl", () => {
    it("normalizes esm.sh URL", () => {
      const result = normalizeHttpUrl("https://esm.sh/lodash@4.17.21");
      assert(result.includes("target=es2022"));
      assert(result.includes("external=react"));
    });

    it("sorts query parameters", () => {
      const result = normalizeHttpUrl("https://esm.sh/pkg@1.0?z=1&a=2");
      const url = new URL(result);
      const keys = [...url.searchParams.keys()];

      for (let i = 1; i < keys.length; i++) {
        assert(keys[i] >= keys[i - 1]);
      }
    });

    it("returns raw string for invalid URLs", () => {
      assertEquals(normalizeHttpUrl("not-a-url"), "not-a-url");
    });

    it("idempotent: normalizing twice produces same result", () => {
      const url = "https://esm.sh/lodash@4.17.21";
      const once = normalizeHttpUrl(url);
      const twice = normalizeHttpUrl(once);
      assertEquals(once, twice);
    });
  });

  // ── gzip detection patterns ──
  describe("gzip detection", () => {
    function isGzipEncoded(s: string): boolean {
      return s.startsWith("gz:") || s.startsWith("gzip:");
    }

    it("detects gz: prefix", () => {
      assertEquals(isGzipEncoded("gz:H4sIAA..."), true);
    });

    it("detects gzip: prefix", () => {
      assertEquals(isGzipEncoded("gzip:compressed-data"), true);
    });

    it("rejects normal JavaScript", () => {
      assertEquals(isGzipEncoded("export const foo = 1;"), false);
    });

    it("rejects empty string", () => {
      assertEquals(isGzipEncoded(""), false);
    });
  });
});
