import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  collectModulesToLoad,
  DATA_FETCH_TIMEOUT_MS,
  hasDataFetchingFunction,
  MODULE_LOAD_TIMEOUT_MS,
  SSR_RENDER_TIMEOUT_MS,
} from "./module-collection.ts";

describe("module-collection", () => {
  describe("timeout constants", () => {
    it("has reasonable timeout values", () => {
      assertEquals(MODULE_LOAD_TIMEOUT_MS, 10000);
      assertEquals(DATA_FETCH_TIMEOUT_MS, 15000);
      assertEquals(SSR_RENDER_TIMEOUT_MS, 20000);
    });
  });

  describe("collectModulesToLoad", () => {
    it("returns page module for component pages in pages/app dir", () => {
      const modules = collectModulesToLoad(
        "/pages/index.tsx",
        true, // isComponentPage
        true, // isInPagesOrAppDir
        [],
      );

      assertEquals(modules.length, 1);
      assertEquals(modules[0]?.type, "page");
      assertEquals(modules[0]?.path, "/pages/index.tsx");
    });

    it("returns empty array for non-component pages", () => {
      const modules = collectModulesToLoad(
        "/pages/about.mdx",
        false, // isComponentPage
        true, // isInPagesOrAppDir
        [],
      );

      assertEquals(modules.length, 0);
    });

    it("returns empty array for pages not in pages/app dir", () => {
      const modules = collectModulesToLoad(
        "/other/page.tsx",
        true, // isComponentPage
        false, // isInPagesOrAppDir
        [],
      );

      assertEquals(modules.length, 0);
    });

    it("includes tsx layouts from nestedLayouts", () => {
      const modules = collectModulesToLoad(
        "/pages/index.tsx",
        true,
        true,
        [
          { kind: "tsx", componentPath: "/layouts/_layout.tsx" },
          { kind: "tsx", componentPath: "/layouts/nested.tsx" },
        ],
      );

      assertEquals(modules.length, 3);
      assertEquals(modules[0]?.type, "page");
      assertEquals(modules[1]?.type, "layout");
      assertEquals(modules[1]?.path, "/layouts/_layout.tsx");
      assertEquals(modules[2]?.type, "layout");
      assertEquals(modules[2]?.path, "/layouts/nested.tsx");
    });

    it("skips non-tsx layouts", () => {
      const modules = collectModulesToLoad(
        "/pages/index.tsx",
        true,
        true,
        [
          { kind: "mdx", componentPath: "/layouts/_layout.mdx" },
          { kind: "html" },
        ],
      );

      assertEquals(modules.length, 1); // Only the page
    });

    it("skips tsx layouts without componentPath", () => {
      const modules = collectModulesToLoad(
        "/pages/index.tsx",
        true,
        true,
        [{ kind: "tsx" }],
      );

      assertEquals(modules.length, 1); // Only the page
    });
  });

  describe("hasDataFetchingFunction", () => {
    it("returns true for modules with getServerData", () => {
      assertEquals(hasDataFetchingFunction({ getServerData: () => ({}) }), true);
    });

    it("returns true for modules with getStaticData", () => {
      assertEquals(hasDataFetchingFunction({ getStaticData: () => ({}) }), true);
    });

    it("returns true for modules with both functions", () => {
      assertEquals(
        hasDataFetchingFunction({
          getServerData: () => ({}),
          getStaticData: () => ({}),
        }),
        true,
      );
    });

    it("returns false for modules without data functions", () => {
      assertEquals(hasDataFetchingFunction({ default: () => {} }), false);
    });

    it("returns false for non-functions named getServerData/getStaticData", () => {
      assertEquals(hasDataFetchingFunction({ getServerData: "not a function" }), false);
      assertEquals(hasDataFetchingFunction({ getStaticData: 123 }), false);
    });

    it("returns false for null/undefined", () => {
      assertEquals(hasDataFetchingFunction(null), false);
      assertEquals(hasDataFetchingFunction(undefined), false);
    });

    it("returns false for primitives", () => {
      assertEquals(hasDataFetchingFunction("string"), false);
      assertEquals(hasDataFetchingFunction(123), false);
    });
  });
});
