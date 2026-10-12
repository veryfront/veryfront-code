import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { clearReactPathsCache, getLocalReactPaths, isReactSpecifier } from "./react-paths.ts";
import { isBun, isNode } from "./runtime.ts";
import { createRequire } from "node:module";

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
      if (isBun || isNode) {
        assertEquals(Object.keys(paths).length > 0, true);
      } else {
        assertEquals(Object.keys(paths).length, 0);
      }
    });

    it("should return empty object outside Node and Bun", () => {
      if (isBun || isNode) return;
      const paths = getLocalReactPaths();
      assertEquals(paths, {});
    });

    it("renders Node JSX from a cache outside node_modules with the framework React singleton", async () => {
      if (!isNode) return;
      const paths = getLocalReactPaths();
      assertEquals(paths["react/jsx-runtime"]?.startsWith("file:"), true);
      const code = `import React from ${JSON.stringify(paths.react)};
        import { jsx } from ${JSON.stringify(paths["react/jsx-runtime"])};
        import { renderToStaticMarkup } from ${JSON.stringify(paths["react-dom/server"])};
        function Page() { const [value] = React.useState("offline-render"); return jsx("main", {children: value}); }
        export const html = renderToStaticMarkup(jsx(Page, {}));
        export { React };`;
      const rendered = await import(`data:text/javascript,${encodeURIComponent(code)}`);
      const frameworkReact = createRequire(import.meta.url)("react");
      assertEquals(rendered.React === frameworkReact, true);
      assertEquals(rendered.html, "<main>offline-render</main>");
    });

    it("should return same result on repeated calls (cache)", () => {
      const paths1 = getLocalReactPaths();
      const paths2 = getLocalReactPaths();
      assertEquals(paths1, paths2);
      assertEquals(Object.isFrozen(paths1), true);
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
