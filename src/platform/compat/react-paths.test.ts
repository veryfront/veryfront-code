import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { clearReactPathsCache, getLocalReactPaths, isReactSpecifier } from "./react-paths.ts";

describe("react-paths", () => {
  describe("isReactSpecifier", () => {
    const cases: Array<[string, boolean]> = [
      ["react", true],
      ["react-dom", true],
      ["react/jsx-runtime", true],
      ["react/jsx-dev-runtime", true],
      ["react-dom/client", true],
      ["react-dom/server", true],
      ["vue", false],
      ["preact", false],
      ["react-query", false],
      ["", false],
      ["@react-spring/core", false],
    ];

    for (const [specifier, expected] of cases) {
      it(`should return ${expected} for '${specifier}'`, () => {
        assertEquals(isReactSpecifier(specifier), expected);
      });
    }
  });

  describe("getLocalReactPaths", () => {
    it("should return an empty object on Deno", () => {
      // On Deno, returns empty because Deno uses esm.sh URLs
      const paths = getLocalReactPaths();
      assertEquals(typeof paths, "object");
      assertEquals(Object.keys(paths).length, 0);
    });
  });

  describe("clearReactPathsCache", () => {
    it("should not throw when clearing cache", () => {
      clearReactPathsCache();
      const paths = getLocalReactPaths();
      assertEquals(typeof paths, "object");
    });
  });
});
