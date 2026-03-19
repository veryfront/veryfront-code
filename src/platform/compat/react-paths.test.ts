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

    it("should return empty object on Deno/Node", () => {
      if (isBun) return; // Bun resolves React paths
      const paths = getLocalReactPaths();
      assertEquals(paths, {});
    });

    it("should return same result on repeated calls (cache)", () => {
      const paths1 = getLocalReactPaths();
      const paths2 = getLocalReactPaths();
      assertEquals(paths1, paths2);
    });
  });

  describe("clearReactPathsCache", () => {
    it("should not throw when clearing cache", () => {
      clearReactPathsCache();
      const paths = getLocalReactPaths();
      assertEquals(typeof paths, "object");
    });

    it("should allow fresh resolution after clearing", () => {
      getLocalReactPaths();
      clearReactPathsCache();
      const paths = getLocalReactPaths();
      assertEquals(typeof paths, "object");
    });
  });

  describe("isReactSpecifier edge cases", () => {
    it("should return true for react-dom/* subpaths", () => {
      assertEquals(isReactSpecifier("react-dom/test-utils"), true);
    });

    it("should return true for react/* subpaths", () => {
      assertEquals(isReactSpecifier("react/compiler"), true);
    });

    it("should return false for react-native", () => {
      assertEquals(isReactSpecifier("react-native"), false);
    });
  });
});
