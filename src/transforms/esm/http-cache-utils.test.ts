import "#veryfront/schemas/_test-setup.ts";
/** @module transforms/esm/http-cache-utils.test
 *
 * Unit tests for the pure-logic helpers behind http-cache.ts. Every case runs
 * against the exported production implementation, so gutting a helper fails
 * here instead of silently drifting away from a test-local copy.
 */

import { gzipSync } from "node:zlib";
import { assert, assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { VERSION } from "#veryfront/utils/version.ts";
import type { CacheBackend } from "#veryfront/cache/types.ts";
import {
  ensureAbsoluteDir,
  hasIncompatibleFilePaths,
  isCanonicalReactEsmUrl,
  isExternalScheme,
  isHttpUrl,
  isInternalBare,
  isRelative,
  normalizeEsmShUrl,
  normalizeHttpUrl,
} from "./http-cache-helpers.ts";
import { __setDistributedCacheAccessorForTests, httpBundleCache } from "./http-cache-wrapper.ts";

class MemoryCacheBackendStub implements CacheBackend {
  readonly type = "memory" as const;
  readonly entries = new Map<string, string>();

  get(key: string): Promise<string | null> {
    return Promise.resolve(this.entries.get(key) ?? null);
  }

  set(key: string, value: string): Promise<void> {
    this.entries.set(key, value);
    return Promise.resolve();
  }

  del(key: string): Promise<void> {
    this.entries.delete(key);
    return Promise.resolve();
  }
}

async function withBackend(
  fn: (backend: MemoryCacheBackendStub) => Promise<void>,
): Promise<void> {
  const backend = new MemoryCacheBackendStub();
  __setDistributedCacheAccessorForTests(() => Promise.resolve(backend));
  try {
    await fn(backend);
  } finally {
    __setDistributedCacheAccessorForTests(null);
  }
}

function gzipPayload(prefix: "gz:" | "gzip:", code: string): string {
  return `${prefix}${btoa(String.fromCharCode(...gzipSync(new TextEncoder().encode(code))))}`;
}

describe("http-cache utilities", () => {
  // ── distributed cache keys ──
  describe("distributed cache keys", () => {
    it("writes url, code and hash entries under the versioned key format", async () => {
      await withBackend(async (backend) => {
        await httpBundleCache.setCode(
          "abc123",
          "export const x = 1;" as never,
          "https://esm.sh/x@1.0.0",
          60,
        );

        assertEquals(
          [...backend.entries.keys()].sort(),
          [`${VERSION}:code:abc123`, `${VERSION}:hash:abc123`, `${VERSION}:url:abc123`],
          "every bundle key is namespaced by release version and prefix",
        );
      });
    });

    it("keys a legacy decimal hash the same way", async () => {
      await withBackend(async (backend) => {
        await httpBundleCache.setCode(
          "12345",
          "export const x = 1;" as never,
          "https://esm.sh/x@1.0.0",
          60,
        );

        assert(
          backend.entries.has(`${VERSION}:code:12345`),
          "a legacy decimal hash uses the same versioned key format",
        );
      });
    });
  });

  // ── hasIncompatibleFilePaths ──
  describe("hasIncompatibleFilePaths", () => {
    it("returns false when no file:// paths", () => {
      assertEquals(
        hasIncompatibleFilePaths("const x = 1;", "/local/cache"),
        false,
        "code without file:// paths is compatible everywhere",
      );
    });

    it("returns false when paths match local cache dir", () => {
      const code = `import f from "file:///local/cache/veryfront-http-bundle/http-123.mjs"`;
      assertEquals(
        hasIncompatibleFilePaths(code, "/local/cache/veryfront-http-bundle"),
        false,
        "a bundle path under the local cache dir is compatible",
      );
    });

    it("returns true when paths from different environment", () => {
      const code = `import f from "file:///app/.cache/veryfront-http-bundle/http-123.mjs"`;
      assertEquals(
        hasIncompatibleFilePaths(code, "/local/cache/veryfront-http-bundle"),
        true,
        "another environment's bundle path is incompatible",
      );
    });

    it("rejects a sibling directory that merely shares the cache dir prefix", () => {
      const code = `import f from "file:///local/cache-other/veryfront-http-bundle/http-123.mjs"`;
      assertEquals(
        hasIncompatibleFilePaths(code, "/local/cache"),
        true,
        "the cache dir match is a path boundary, not a bare string prefix",
      );
    });

    it("ignores non-bundle file:// paths", () => {
      const code = `import f from "file:///some/other/path.mjs"`;
      assertEquals(
        hasIncompatibleFilePaths(code, "/local/cache"),
        false,
        "only veryfront bundle paths are environment-bound",
      );
    });

    it("detects first incompatible path among multiple", () => {
      const code = [
        `import a from "file:///local/cache/veryfront-http-bundle/http-aaa.mjs";`,
        `import b from "file:///app/.cache/veryfront-http-bundle/http-bbb.mjs";`,
      ].join("\n");
      assertEquals(
        hasIncompatibleFilePaths(code, "/local/cache/veryfront-http-bundle"),
        true,
        "one foreign path is enough to reject the artifact",
      );
    });

    it("handles concurrent calls safely (new regex per call)", () => {
      const code1 = `import f from "file:///app/veryfront-http-bundle/http-1.mjs"`;
      const code2 = `import f from "file:///app/veryfront-http-bundle/http-2.mjs"`;
      assertEquals(hasIncompatibleFilePaths(code1, "/local"), true, "first call rejects");
      assertEquals(
        hasIncompatibleFilePaths(code2, "/local"),
        true,
        "a repeated call is not affected by leftover regex state",
      );
    });
  });

  // ── ensureAbsoluteDir ──
  describe("ensureAbsoluteDir", () => {
    it("returns absolute path unchanged", () => {
      assertEquals(
        ensureAbsoluteDir("/absolute/path"),
        "/absolute/path",
        "an absolute cache dir is used as given",
      );
    });

    it("prefixes relative path with cwd", () => {
      const result = ensureAbsoluteDir("relative/path");
      assert(result.startsWith("/"), "a relative cache dir is resolved to an absolute path");
      assert(result.includes("relative/path"), "the relative segment is preserved");
    });
  });

  // ── isHttpUrl ──
  describe("isHttpUrl", () => {
    it("recognizes https URLs", () => {
      assertEquals(isHttpUrl("https://esm.sh/react"), true, "https is an HTTP module URL");
    });

    it("recognizes http URLs", () => {
      assertEquals(isHttpUrl("http://localhost:3000"), true, "http is an HTTP module URL");
    });

    it("rejects non-http URLs", () => {
      assertEquals(isHttpUrl("file:///path"), false, "file: is not an HTTP module URL");
      assertEquals(isHttpUrl("node:fs"), false, "node: is not an HTTP module URL");
      assertEquals(isHttpUrl("react"), false, "a bare specifier is not an HTTP module URL");
      assertEquals(isHttpUrl("./relative"), false, "a relative path is not an HTTP module URL");
    });
  });

  // ── canonical React esm.sh URLs ──
  describe("isCanonicalReactEsmUrl", () => {
    it("matches react on esm.sh", () => {
      assertEquals(
        isCanonicalReactEsmUrl("https://esm.sh/react@18.3.1"),
        true,
        "a pinned react package is canonical",
      );
    });

    it("matches react-dom on esm.sh", () => {
      assertEquals(
        isCanonicalReactEsmUrl("https://esm.sh/react-dom@18.3.1"),
        true,
        "a pinned react-dom package is canonical",
      );
    });

    it("matches versioned paths like /v150/react@18.3.1", () => {
      assertEquals(
        isCanonicalReactEsmUrl("https://esm.sh/v150/react@18.3.1"),
        true,
        "a /vNNN/ build prefix still resolves to canonical react",
      );
    });

    it("matches /stable/ prefix", () => {
      assertEquals(
        isCanonicalReactEsmUrl("https://esm.sh/stable/react@18.3.1"),
        true,
        "a /stable/ build prefix still resolves to canonical react",
      );
    });

    it("matches react with subpath", () => {
      assertEquals(
        isCanonicalReactEsmUrl("https://esm.sh/react@18.3.1/jsx-runtime"),
        true,
        "a react subpath belongs to the canonical react graph",
      );
    });

    it("rejects a version that is not a full exact SemVer", () => {
      assertEquals(
        isCanonicalReactEsmUrl("https://esm.sh/react@18"),
        false,
        "an ambient major-only version is not a canonical React identity",
      );
    });

    it("rejects non-esm.sh URLs", () => {
      assertEquals(
        isCanonicalReactEsmUrl("https://cdn.example.com/react@18.3.1"),
        false,
        "another CDN is not the canonical React host",
      );
    });

    it("rejects hosts that merely contain esm.sh", () => {
      assertEquals(
        isCanonicalReactEsmUrl("https://evil-esm.sh.example.com/react@18.3.1"),
        false,
        "the canonical React host must match exactly, not by substring",
      );
    });

    it("rejects non-React packages on esm.sh", () => {
      assertEquals(
        isCanonicalReactEsmUrl("https://esm.sh/lodash@4.17.21"),
        false,
        "an unrelated package is not canonical React",
      );
    });

    it("rejects packages that start with react but are different", () => {
      assertEquals(
        isCanonicalReactEsmUrl("https://esm.sh/react-query@3.0.0"),
        false,
        "only react and react-dom are canonical",
      );
    });

    it("handles invalid URLs", () => {
      assertEquals(
        isCanonicalReactEsmUrl("not-a-url"),
        false,
        "a malformed URL is not canonical React",
      );
    });
  });

  // ── isExternalScheme ──
  describe("isExternalScheme", () => {
    it("detects node: scheme", () => {
      assertEquals(isExternalScheme("node:fs"), true, "node: stays external");
    });

    it("detects data: scheme", () => {
      assertEquals(isExternalScheme("data:text/plain"), true, "data: stays external");
    });

    it("detects file: scheme", () => {
      assertEquals(isExternalScheme("file:///path"), true, "file: stays external");
    });

    it("detects bun: scheme", () => {
      assertEquals(isExternalScheme("bun:test"), true, "bun: stays external");
    });

    it("detects jsr: scheme", () => {
      assertEquals(isExternalScheme("jsr:@std/path"), true, "jsr: stays external");
    });

    it("rejects http/https", () => {
      assertEquals(
        isExternalScheme("https://example.com"),
        false,
        "https modules are cached, not external",
      );
      assertEquals(
        isExternalScheme("http://example.com"),
        false,
        "http modules are cached, not external",
      );
    });

    it("rejects bare specifiers", () => {
      assertEquals(isExternalScheme("react"), false, "a bare specifier is not an external scheme");
      assertEquals(
        isExternalScheme("lodash/fp"),
        false,
        "a bare subpath is not an external scheme",
      );
    });
  });

  // ── isRelative ──
  describe("isRelative", () => {
    it("detects ./ paths", () => {
      assertEquals(isRelative("./utils.js"), true, "./ is relative");
    });

    it("detects ../ paths", () => {
      assertEquals(isRelative("../lib/foo.js"), true, "../ is relative");
    });

    it("detects / absolute paths", () => {
      assertEquals(isRelative("/root/path.js"), true, "a rooted path is resolved like a relative");
    });

    it("rejects bare specifiers", () => {
      assertEquals(isRelative("react"), false, "a bare specifier is not relative");
      assertEquals(isRelative("lodash"), false, "a bare specifier is not relative");
    });

    it("rejects URLs", () => {
      assertEquals(isRelative("https://example.com"), false, "an absolute URL is not relative");
    });
  });

  // ── isInternalBare ──
  describe("isInternalBare", () => {
    it("detects veryfront/ specifiers", () => {
      assertEquals(isInternalBare("veryfront/head"), true, "veryfront/ is internal");
    });

    it("detects @std/ specifiers", () => {
      assertEquals(isInternalBare("@std/path"), true, "@std/ is internal");
    });

    it("detects private hash-import aliases", () => {
      assertEquals(isInternalBare("#veryfront/utils"), true, "#veryfront/ is internal");
      assertEquals(isInternalBare("#project/env"), true, "any # alias is internal");
    });

    it("detects _veryfront/ specifiers", () => {
      assertEquals(isInternalBare("_veryfront/lib.js"), true, "_veryfront/ is internal");
      assertEquals(isInternalBare("/_veryfront/lib.js"), true, "/_veryfront/ is internal");
    });

    it("rejects other specifiers", () => {
      assertEquals(isInternalBare("react"), false, "a public package is not internal");
      assertEquals(isInternalBare("lodash"), false, "a public package is not internal");
      assertEquals(
        isInternalBare("@scope/package"),
        false,
        "an unrelated scoped package is not internal",
      );
    });
  });

  // ── normalizeEsmShUrl ──
  describe("normalizeEsmShUrl", () => {
    it("removes /denonext/ from pathname", () => {
      const url = new URL("https://esm.sh/denonext/lodash@4.17.21");
      normalizeEsmShUrl(url);
      assertEquals(
        url.pathname.includes("denonext"),
        false,
        "a leading /denonext/ target selector is dropped",
      );
    });

    it("adds target=es2022 when missing", () => {
      const url = new URL("https://esm.sh/lodash@4.17.21");
      normalizeEsmShUrl(url);
      assertEquals(url.searchParams.get("target"), "es2022", "a default target is pinned");
    });

    it("preserves existing target parameter", () => {
      const url = new URL("https://esm.sh/lodash@4.17.21?target=es2020");
      normalizeEsmShUrl(url);
      assertEquals(
        url.searchParams.get("target"),
        "es2020",
        "an explicit target is left untouched",
      );
    });

    it("adds external=react for non-React packages", () => {
      const url = new URL("https://esm.sh/lodash@4.17.21");
      normalizeEsmShUrl(url);
      const ext = url.searchParams.get("external");
      assertExists(ext, "a non-React package gets an external list");
      assert(ext.includes("react"), "React stays external so the singleton is preserved");
    });

    it("does not add external=react for base react package", () => {
      const url = new URL("https://esm.sh/react@18.3.1");
      normalizeEsmShUrl(url);
      assertEquals(
        url.searchParams.get("external"),
        null,
        "React itself cannot be external to itself",
      );
    });

    it("appends react to existing externals", () => {
      const url = new URL("https://esm.sh/some-pkg@1.0?external=preact");
      normalizeEsmShUrl(url);
      const ext = url.searchParams.get("external")!;
      assert(ext.includes("preact"), "an existing external is preserved");
      assert(ext.includes("react"), "React is appended to the existing external list");
    });

    it("does not duplicate react in externals", () => {
      const url = new URL("https://esm.sh/some-pkg@1.0?external=react");
      normalizeEsmShUrl(url);
      assertEquals(
        url.searchParams.get("external"),
        "react",
        "React is not appended twice",
      );
    });

    it("is a no-op for non-esm.sh URLs", () => {
      const url = new URL("https://cdn.example.com/pkg@1.0");
      const before = url.toString();
      normalizeEsmShUrl(url);
      assertEquals(url.toString(), before, "only esm.sh URLs are canonicalized");
    });
  });

  // ── normalizeHttpUrl ──
  describe("normalizeHttpUrl", () => {
    it("normalizes esm.sh URL", () => {
      assertEquals(
        normalizeHttpUrl("https://esm.sh/lodash@4.17.21"),
        "https://esm.sh/lodash@4.17.21?external=react&target=es2022",
        "an esm.sh URL is canonicalized to one pinned identity",
      );
    });

    it("preserves literal commas in the external list", () => {
      assertEquals(
        normalizeHttpUrl("https://esm.sh/some-pkg@1.0.0?external=react,react-dom"),
        "https://esm.sh/some-pkg@1.0.0?external=react,react-dom&target=es2022",
        "esm.sh list params must not be percent-encoded",
      );
    });

    it("sorts query parameters", () => {
      const result = normalizeHttpUrl("https://esm.sh/pkg@1.0?z=1&a=2");
      const keys = [...new URL(result).searchParams.keys()];
      assertEquals(keys, [...keys].sort(), "query parameters are sorted for a stable identity");
    });

    it("returns raw string for invalid URLs", () => {
      assertEquals(
        normalizeHttpUrl("not-a-url"),
        "not-a-url",
        "a malformed URL is returned unchanged",
      );
    });

    it("idempotent: normalizing twice produces same result", () => {
      const once = normalizeHttpUrl("https://esm.sh/lodash@4.17.21");
      assertEquals(normalizeHttpUrl(once), once, "normalization is a fixed point");
    });
  });

  // ── gzip decoding through the cache gateway ──
  describe("gzip decoding", () => {
    it("decodes a gz: payload", async () => {
      await withBackend(async (backend) => {
        const code = "export const compressed = 1;";
        backend.entries.set(`${VERSION}:code:a1`, gzipPayload("gz:", code));

        const result = await httpBundleCache.getCodeByHash("a1");
        assertEquals(result.code as unknown as string, code, "a gz: payload is inflated");
        assertEquals(result.wasGzipped, true, "the gz: prefix is reported as gzipped");
      });
    });

    it("decodes a gzip: payload", async () => {
      await withBackend(async (backend) => {
        const code = "export const compressed = 2;";
        backend.entries.set(`${VERSION}:code:a2`, gzipPayload("gzip:", code));

        const result = await httpBundleCache.getCodeByHash("a2");
        assertEquals(result.code as unknown as string, code, "a gzip: payload is inflated");
        assertEquals(result.wasGzipped, true, "the gzip: prefix is reported as gzipped");
      });
    });

    it("returns normal JavaScript untouched", async () => {
      await withBackend(async (backend) => {
        const code = "export const foo = 1;";
        backend.entries.set(`${VERSION}:code:a3`, code);

        const result = await httpBundleCache.getCodeByHash("a3");
        assertEquals(result.code as unknown as string, code, "uncompressed code is passed through");
        assertEquals(result.wasGzipped, false, "uncompressed code is not reported as gzipped");
      });
    });

    it("reports an empty cache entry as a miss", async () => {
      await withBackend(async (backend) => {
        backend.entries.set(`${VERSION}:code:a4`, "");

        const result = await httpBundleCache.getCodeByHash("a4");
        assertEquals(result.code, null, "an empty cache entry yields no code");
        assertEquals(result.failReason, "not_found", "an empty cache entry is a miss");
      });
    });
  });
});
