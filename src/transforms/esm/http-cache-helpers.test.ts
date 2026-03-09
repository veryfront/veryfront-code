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
  normalizeEsmShUrl,
  normalizeHttpUrl,
} from "./http-cache-helpers.ts";

describe("transforms/esm/http-cache-helpers", () => {
  describe("isHttpUrl", () => {
    const table: [string, boolean][] = [
      ["https://esm.sh/react", true],
      ["http://example.com/mod.js", true],
      ["file:///path/to/file", false],
      ["node:fs", false],
      ["react", false],
      ["./foo", false],
      ["", false],
    ];

    for (const [input, expected] of table) {
      it(`"${input}" → ${expected}`, () => {
        assertEquals(isHttpUrl(input), expected);
      });
    }
  });

  describe("isExternalScheme", () => {
    const table: [string, boolean][] = [
      ["node:fs", true],
      ["data:text/javascript,", true],
      ["file:///path", true],
      ["bun:test", true],
      ["https://esm.sh/react", false],
      ["react", false],
      ["", false],
    ];

    for (const [input, expected] of table) {
      it(`"${input}" → ${expected}`, () => {
        assertEquals(isExternalScheme(input), expected);
      });
    }
  });

  describe("isRelative", () => {
    const table: [string, boolean][] = [
      ["./foo", true],
      ["../bar", true],
      ["/absolute", true],
      ["react", false],
      ["https://esm.sh/react", false],
      ["", false],
    ];

    for (const [input, expected] of table) {
      it(`"${input}" → ${expected}`, () => {
        assertEquals(isRelative(input), expected);
      });
    }
  });

  describe("isParentHttpModule", () => {
    it("returns true for https URL", () => {
      assertEquals(isParentHttpModule("https://esm.sh/react"), true);
    });

    it("returns true for http URL", () => {
      assertEquals(isParentHttpModule("http://example.com"), true);
    });

    it("returns false for undefined", () => {
      assertEquals(isParentHttpModule(undefined), false);
    });

    it("returns false for empty string", () => {
      assertEquals(isParentHttpModule(""), false);
    });

    it("returns false for file URL", () => {
      assertEquals(isParentHttpModule("file:///path"), false);
    });
  });

  describe("isInternalBare", () => {
    const table: [string, boolean][] = [
      ["veryfront/utils", true],
      ["#veryfront/testing/assert.ts", true],
      ["@std/path", true],
      ["_vf_modules/react", true],
      ["/_vf_modules/react", true],
      ["_veryfront/foo", true],
      ["/_veryfront/bar", true],
      ["react", false],
      ["@tanstack/react-query", false],
      ["", false],
    ];

    for (const [input, expected] of table) {
      it(`"${input}" → ${expected}`, () => {
        assertEquals(isInternalBare(input), expected);
      });
    }
  });

  describe("ensureAbsoluteDir", () => {
    it("returns absolute path unchanged", () => {
      assertEquals(ensureAbsoluteDir("/home/user/.cache"), "/home/user/.cache");
    });

    it("prepends cwd for relative path", () => {
      const result = ensureAbsoluteDir("relative/path");
      assertEquals(result.startsWith("/"), true);
      assertEquals(result.endsWith("relative/path"), true);
    });
  });

  describe("normalizeEsmShUrl", () => {
    it("removes /denonext/ from path", () => {
      const url = new URL("https://esm.sh/denonext/react@18");
      normalizeEsmShUrl(url);
      assertEquals(url.pathname, "/react@18");
    });

    it("adds target=es2022 if missing", () => {
      const url = new URL("https://esm.sh/react@18");
      normalizeEsmShUrl(url);
      assertEquals(url.searchParams.get("target"), "es2022");
    });

    it("does not override existing target", () => {
      const url = new URL("https://esm.sh/react@18?target=esnext");
      normalizeEsmShUrl(url);
      assertEquals(url.searchParams.get("target"), "esnext");
    });

    it("adds react to external list for non-react packages", () => {
      const url = new URL("https://esm.sh/lodash@4");
      normalizeEsmShUrl(url);
      assertEquals(url.searchParams.get("external")!.includes("react"), true);
    });

    it("does not add react external to base react package", () => {
      const url = new URL("https://esm.sh/react@18.2.0");
      normalizeEsmShUrl(url);
      assertEquals(url.searchParams.has("external"), false);
    });

    it("appends react to existing externals", () => {
      const url = new URL("https://esm.sh/my-lib@1.0.0?external=preact");
      normalizeEsmShUrl(url);
      assertEquals(url.searchParams.get("external"), "preact,react");
    });

    it("does not duplicate react in externals", () => {
      const url = new URL("https://esm.sh/my-lib@1.0.0?external=react");
      normalizeEsmShUrl(url);
      assertEquals(url.searchParams.get("external"), "react");
    });

    it("does nothing for non-esm.sh URLs", () => {
      const url = new URL("https://cdn.jsdelivr.net/npm/react@18");
      const originalHref = url.href;
      normalizeEsmShUrl(url);
      assertEquals(url.href, originalHref);
    });
  });

  describe("normalizeHttpUrl", () => {
    it("normalizes an esm.sh URL", () => {
      const result = normalizeHttpUrl("https://esm.sh/lodash@4");
      assertEquals(result.includes("target=es2022"), true);
    });

    it("sorts search params", () => {
      const result = normalizeHttpUrl("https://esm.sh/lib?z=1&a=2");
      assertEquals(result.includes("a=2"), true);
    });

    it("returns malformed input unchanged", () => {
      assertEquals(normalizeHttpUrl("not a url"), "not a url");
    });

    it("returns empty string unchanged", () => {
      assertEquals(normalizeHttpUrl(""), "");
    });
  });

  describe("hasIncompatibleFilePaths", () => {
    it("returns false when no file:// paths", () => {
      assertEquals(hasIncompatibleFilePaths("const x = 1;", "/cache"), false);
    });

    it("returns false for compatible paths", () => {
      const code = `import "file:///cache/veryfront-http-bundle/http-12345.mjs";`;
      assertEquals(hasIncompatibleFilePaths(code, "/cache"), false);
    });

    it("returns true for incompatible paths", () => {
      const code = `import "file:///other/veryfront-http-bundle/http-12345.mjs";`;
      assertEquals(hasIncompatibleFilePaths(code, "/cache"), true);
    });

    it("ignores file:// paths that are not veryfront-http-bundle", () => {
      const code = `import "file:///other/some-lib/module.mjs";`;
      assertEquals(hasIncompatibleFilePaths(code, "/cache"), false);
    });

    it("handles empty code", () => {
      assertEquals(hasIncompatibleFilePaths("", "/cache"), false);
    });
  });
});
