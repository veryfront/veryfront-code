import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertMatch, assertNotEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  buildHttpCacheIdentity,
  ensureAbsoluteDir,
  fingerprintImportMap,
  getCanonicalReactEsmVersion,
  hashHttpCacheIdentity,
  hasIncompatibleFilePaths,
  isExternalScheme,
  isHttpUrl,
  isInternalBare,
  isParentHttpModule,
  isRelative,
  normalizeHttpUrl,
  prepareHttpCacheRequestOptions,
  resolveBareSpecifier,
} from "./http-cache-helpers.ts";

describe("transforms/esm/http-cache-helpers", () => {
  describe("cache identity", () => {
    it("uses a full SHA-256 fingerprint for import maps that collide under 32-bit hashing", async () => {
      const aaFingerprint = await fingerprintImportMap({
        imports: { collision: "Aa" },
        scopes: {},
      });
      const bbFingerprint = await fingerprintImportMap({
        imports: { collision: "BB" },
        scopes: {},
      });

      assertMatch(aaFingerprint, /^[a-f0-9]{64}$/);
      assertMatch(bbFingerprint, /^[a-f0-9]{64}$/);
      assertNotEquals(aaFingerprint, bbFingerprint);

      const aaIdentity = await buildHttpCacheIdentity("https://modules.example.com/root.js", {
        importMap: { imports: { collision: "Aa" }, scopes: {} },
      });
      const bbIdentity = await buildHttpCacheIdentity("https://modules.example.com/root.js", {
        importMap: { imports: { collision: "BB" }, scopes: {} },
      });
      assertMatch(aaIdentity, /^veryfront:http-module:v2:/);
      assertMatch(await hashHttpCacheIdentity(aaIdentity), /^[a-f0-9]{64}$/);
      assertNotEquals(
        await hashHttpCacheIdentity(aaIdentity),
        await hashHttpCacheIdentity(bbIdentity),
      );
    });

    it("frames URL and React version components without delimiter collisions", async () => {
      const importMap = { imports: {}, scopes: {} };

      assertNotEquals(
        await buildHttpCacheIdentity(
          "https://modules.example.com/root:react=19.0.0",
          { importMap },
        ),
        await buildHttpCacheIdentity("https://modules.example.com/root", {
          importMap,
          reactVersion: "19.0.0",
        }),
      );
    });

    it("canonicalizes and fingerprints one import map once per prepared request graph", async () => {
      let importEnumerations = 0;
      const imports = new Proxy({ pkg: "https://modules.example.com/pkg.js" }, {
        ownKeys(target) {
          importEnumerations++;
          return Reflect.ownKeys(target);
        },
      });
      const options = prepareHttpCacheRequestOptions({
        cacheDir: ".cache",
        importMap: { imports, scopes: {} },
      });

      await Promise.all([
        buildHttpCacheIdentity("https://modules.example.com/a.js", options),
        buildHttpCacheIdentity("https://modules.example.com/b.js", options),
        buildHttpCacheIdentity("https://modules.example.com/c.js", options),
      ]);

      assertEquals(importEnumerations, 1);
    });

    it("does not reuse a prepared fingerprint across separate top-level requests", async () => {
      const importMap = {
        imports: { pkg: "https://modules.example.com/v1.js" },
        scopes: {},
      };
      const firstOptions = prepareHttpCacheRequestOptions({ cacheDir: ".cache", importMap });
      const first = await buildHttpCacheIdentity(
        "https://modules.example.com/root.js",
        firstOptions,
      );

      importMap.imports.pkg = "https://modules.example.com/v2.js";
      const secondOptions = prepareHttpCacheRequestOptions({ cacheDir: ".cache", importMap });
      const second = await buildHttpCacheIdentity(
        "https://modules.example.com/root.js",
        secondOptions,
      );

      assertNotEquals(first, second);
    });
  });

  describe("canonical React cache identity", () => {
    it("recognizes root and pinned esm.sh React packages", () => {
      assertEquals(
        getCanonicalReactEsmVersion("https://esm.sh/react@19.0.0/es2022/react.mjs"),
        "19.0.0",
      );
      assertEquals(
        getCanonicalReactEsmVersion("https://esm.sh/v135/react-dom@18.3.1/server.js"),
        "18.3.1",
      );
      assertEquals(
        getCanonicalReactEsmVersion("https://esm.sh/stable/react@18.3.1/index.js"),
        "18.3.1",
      );
    });

    it("does not classify nested or scoped package subpaths as core React", () => {
      assertEquals(
        getCanonicalReactEsmVersion("https://esm.sh/@scope/react@19.0.0/index.js"),
        null,
      );
      assertEquals(
        getCanonicalReactEsmVersion("https://esm.sh/pkg@1.0.0/react@19.0.0/index.js"),
        null,
      );
    });

    it("normalizes missing ambient versions in canonical identities", async () => {
      const url = "https://esm.sh/react@19.0.0?target=es2022";
      const emptyImportMap = { imports: {}, scopes: {} };

      assertEquals(
        await buildHttpCacheIdentity(url, { importMap: emptyImportMap }),
        await buildHttpCacheIdentity(url, {
          importMap: { imports: { unrelated: "https://example.com/a.js" } },
          reactVersion: "19.0.0",
        }),
      );
    });
  });

  describe("isHttpUrl", () => {
    it("returns true for https URLs", () => {
      assertEquals(isHttpUrl("https://esm.sh/react@18"), true);
    });

    it("returns true for http URLs", () => {
      assertEquals(isHttpUrl("http://cdn.example.com/lib.js"), true);
    });

    it("returns false for relative paths", () => {
      assertEquals(isHttpUrl("./foo.js"), false);
    });

    it("returns false for bare specifiers", () => {
      assertEquals(isHttpUrl("react"), false);
    });

    it("returns false for file:// URLs", () => {
      assertEquals(isHttpUrl("file:///tmp/foo.js"), false);
    });
  });

  describe("isExternalScheme", () => {
    it("returns true for node: scheme", () => {
      assertEquals(isExternalScheme("node:fs"), true);
    });

    it("returns true for data: scheme", () => {
      assertEquals(isExternalScheme("data:text/plain,hello"), true);
    });

    it("returns true for file: scheme", () => {
      assertEquals(isExternalScheme("file:///tmp/foo.js"), true);
    });

    it("returns true for bun: scheme", () => {
      assertEquals(isExternalScheme("bun:test"), true);
    });

    it("returns true for jsr: scheme", () => {
      assertEquals(isExternalScheme("jsr:@std/dotenv@0.225.6"), true);
    });

    it("returns false for https scheme", () => {
      assertEquals(isExternalScheme("https://example.com"), false);
    });

    it("returns false for bare specifiers", () => {
      assertEquals(isExternalScheme("react"), false);
    });
  });

  describe("isRelative", () => {
    it("returns true for ./ paths", () => {
      assertEquals(isRelative("./foo.js"), true);
    });

    it("returns true for ../ paths", () => {
      assertEquals(isRelative("../foo.js"), true);
    });

    it("returns true for / absolute paths", () => {
      assertEquals(isRelative("/foo.js"), true);
    });

    it("returns false for bare specifiers", () => {
      assertEquals(isRelative("react"), false);
    });

    it("returns false for http URLs", () => {
      assertEquals(isRelative("https://esm.sh/react"), false);
    });
  });

  describe("isParentHttpModule", () => {
    it("returns true when baseUrl is an HTTP URL", () => {
      assertEquals(isParentHttpModule("https://esm.sh/react@18"), true);
    });

    it("returns false when baseUrl is undefined", () => {
      assertEquals(isParentHttpModule(undefined), false);
    });

    it("returns false when baseUrl is a local path", () => {
      assertEquals(isParentHttpModule("/tmp/foo.js"), false);
    });
  });

  describe("isInternalBare", () => {
    it("returns true for veryfront/ imports", () => {
      assertEquals(isInternalBare("veryfront/runtime"), true);
    });

    it("returns true for #veryfront/ imports", () => {
      assertEquals(isInternalBare("#veryfront/utils"), true);
    });

    it("returns true for private import-map aliases", () => {
      assertEquals(isInternalBare("#std/dotenv.ts"), true);
      assertEquals(isInternalBare("#project/env"), true);
    });

    it("returns true for _vf_modules/ imports", () => {
      assertEquals(isInternalBare("_vf_modules/lib.js"), true);
    });

    it("returns true for /_vf_modules/ imports", () => {
      assertEquals(isInternalBare("/_vf_modules/lib.js"), true);
    });

    it("returns true for _veryfront/ imports", () => {
      assertEquals(isInternalBare("_veryfront/lib.js"), true);
    });

    it("returns true for /_veryfront/ imports", () => {
      assertEquals(isInternalBare("/_veryfront/lib.js"), true);
    });

    it("returns true for @std/ imports", () => {
      assertEquals(isInternalBare("@std/path"), true);
    });

    it("returns false for regular bare imports", () => {
      assertEquals(isInternalBare("react"), false);
      assertEquals(isInternalBare("lodash"), false);
    });
  });

  describe("normalizeHttpUrl", () => {
    it("normalizes esm.sh URLs with target param", () => {
      const result = normalizeHttpUrl("https://esm.sh/lodash@4");
      assertEquals(result.includes("target=es2022"), true);
    });

    it("sorts query parameters", () => {
      const result = normalizeHttpUrl("https://esm.sh/lodash@4?z=1&a=2");
      const url = new URL(result);
      const keys = [...url.searchParams.keys()];
      assertEquals(keys, [...keys].sort());
    });

    it("removes /denonext/ from esm.sh paths", () => {
      const result = normalizeHttpUrl("https://esm.sh/denonext/lodash@4");
      assertEquals(result.includes("/denonext/"), false);
    });

    it("returns raw string for malformed URLs", () => {
      assertEquals(normalizeHttpUrl("not-a-url"), "not-a-url");
    });

    it("adds external=react for non-react esm.sh packages", () => {
      const result = normalizeHttpUrl("https://esm.sh/lodash@4");
      assertEquals(result.includes("external="), true);
      assertEquals(result.includes("react"), true);
    });

    it("preserves comma-separated esm.sh external params", () => {
      const result = normalizeHttpUrl(
        "https://esm.sh/recharts@2.15.3?external=react,react-dom&target=es2022",
      );
      assertEquals(result.includes("external=react,react-dom"), true);
      assertEquals(result.includes("%2C"), false);
    });

    it("preserves encoding for non-external comma-separated params", () => {
      const result = normalizeHttpUrl(
        "https://esm.sh/pkg@1.0?deps=a,b&external=react,react-dom&target=es2022",
      );
      assertEquals(result.includes("external=react,react-dom"), true);
      assertEquals(result.includes("deps=a%2Cb"), true);
    });
  });

  describe("ensureAbsoluteDir", () => {
    it("returns absolute paths unchanged", () => {
      assertEquals(ensureAbsoluteDir("/tmp/cache"), "/tmp/cache");
    });

    it("makes relative paths absolute", () => {
      const result = ensureAbsoluteDir("relative/cache");
      assertEquals(result.startsWith("/"), true);
    });
  });

  describe("hasIncompatibleFilePaths", () => {
    it("returns false when no file:// paths exist", () => {
      assertEquals(hasIncompatibleFilePaths("const x = 1;", "/cache"), false);
    });

    it("returns false when bundle paths match local cache dir", () => {
      const code = 'import "file:///cache/veryfront-http-bundle/http-123.mjs";';
      assertEquals(hasIncompatibleFilePaths(code, "/cache"), false);
    });

    it("returns true when bundle paths are from different environment", () => {
      const code = 'import "file:///other/veryfront-http-bundle/http-123.mjs";';
      assertEquals(hasIncompatibleFilePaths(code, "/cache"), true);
    });

    it("ignores non-bundle file:// paths", () => {
      const code = 'import "file:///other/some-file.js";';
      assertEquals(hasIncompatibleFilePaths(code, "/cache"), false);
    });
  });

  describe("resolveBareSpecifier", () => {
    const emptyImportMap = { imports: {}, scopes: {} };

    it("resolves bare specifiers to esm.sh URLs", () => {
      const result = resolveBareSpecifier("lodash", emptyImportMap);
      assertEquals(result.startsWith("https://esm.sh/"), true);
      assertEquals(result.includes("target=es2022"), true);
    });

    it("preserves pinned package versions", () => {
      const result = resolveBareSpecifier("@tanstack/react-query@5.94.4", emptyImportMap);
      assertEquals(result, "https://esm.sh/@tanstack/react-query@5.94.4?target=es2022");
    });

    it("resolves react subpaths", () => {
      const result = resolveBareSpecifier("react/jsx-runtime", emptyImportMap);
      assertEquals(result.includes("react"), true);
    });

    it("resolves react-dom subpaths", () => {
      const result = resolveBareSpecifier("react-dom/client", emptyImportMap);
      assertEquals(result.includes("react-dom"), true);
    });
  });
});
