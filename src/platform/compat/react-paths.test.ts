import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { clearReactPathsCache, getLocalReactPaths, isReactSpecifier } from "./react-paths.ts";
import { isBun } from "./runtime.ts";

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
    it("should return runtime-appropriate local React path mappings", () => {
      const paths = getLocalReactPaths();
      assertEquals(typeof paths, "object");
      if (isBun) {
        assertEquals(Object.keys(paths).length > 0, true);
      } else {
        assertEquals(Object.keys(paths).length, 0);
      }
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
