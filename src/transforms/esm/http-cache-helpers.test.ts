import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  ensureAbsoluteDir,
  hasIncompatibleFilePaths,
  isExternalScheme,
  isHttpUrl,
  isInternalBare,
  isParentHttpModule,
  isRelative,
  normalizeHttpUrl,
  resolveBareSpecifier,
} from "./http-cache-helpers.ts";

describe("transforms/esm/http-cache-helpers", () => {
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
