import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { VERSION } from "#veryfront/utils/version.ts";
import { getLoaderScript } from "./loader.ts";

describe("hydration-script-builder/templates/loader", () => {
  type MutableTestGlobal = Record<string, unknown> & {
    __veryfrontReleaseId?: string | null;
    __veryfrontReleaseAssetModules?: Record<string, string> | null;
  };

  function runGeneratedPathToModuleUrl(
    path: string,
    setup = "",
    studioEmbed = false,
  ): string {
    const globalRecord = globalThis as MutableTestGlobal;
    const previousWindow = globalRecord.window;
    const previousReleaseId = globalRecord.__veryfrontReleaseId;
    const previousReleaseAssetModules = globalRecord.__veryfrontReleaseAssetModules;

    globalRecord.window = globalThis;

    try {
      return new Function(
        "path",
        "studioEmbed",
        `const MODULE_SERVER_URL = '/_vf_modules';\n${getLoaderScript()}\n${setup}\nreturn pathToModuleUrl(path, studioEmbed);`,
      )(path, studioEmbed) as string;
    } finally {
      if (previousWindow === undefined) {
        delete globalRecord.window;
      } else {
        globalRecord.window = previousWindow;
      }

      if (previousReleaseId === undefined) {
        delete globalRecord.__veryfrontReleaseId;
      } else {
        globalRecord.__veryfrontReleaseId = previousReleaseId;
      }

      if (previousReleaseAssetModules === undefined) {
        delete globalRecord.__veryfrontReleaseAssetModules;
      } else {
        globalRecord.__veryfrontReleaseAssetModules = previousReleaseAssetModules;
      }
    }
  }

  describe("getLoaderScript", () => {
    function getResult(): string {
      return getLoaderScript();
    }

    it("should return a non-empty string", () => {
      const result = getResult();
      assertEquals(typeof result, "string");
      assertEquals(result.length > 0, true);
    });

    it("should define componentCache and loadingPromises maps", () => {
      const result = getResult();
      assertEquals(result.includes("const componentCache = new Map()"), true);
      assertEquals(result.includes("const loadingPromises = new Map()"), true);
    });

    it("should define clearComponentCache function", () => {
      const result = getResult();
      assertEquals(result.includes("function clearComponentCache(path)"), true);
    });

    it("should expose clearComponentCache on window", () => {
      const result = getResult();
      assertEquals(
        result.includes("window.__veryfrontClearComponentCache = clearComponentCache"),
        true,
      );
    });

    it("should define appendQueryParam function", () => {
      const result = getResult();
      assertEquals(result.includes("function appendQueryParam(url, key, value)"), true);
    });

    it("should define pathToModuleUrl function", () => {
      const result = getResult();
      assertEquals(result.includes("function pathToModuleUrl(path, studioEmbed)"), true);
    });

    it("should expose release asset module map support", () => {
      const result = getResult();
      assertEquals(result.includes("let __releaseAssetModules = null"), true);
      assertEquals(
        result.includes("window.__veryfrontSetReleaseAssetModules = setReleaseAssetModules"),
        true,
      );
      assertEquals(result.includes("resolveReleaseAssetModuleUrl(path)"), true);
    });

    it("should expose release id support for immutable fallback module URLs", () => {
      const result = getResult();
      assertEquals(result.includes("window.__veryfrontSetReleaseId = setReleaseId"), true);
      assertEquals(result.includes("appendReleaseModuleVersion(url)"), true);
      assertEquals(result.includes("VERYFRONT_RUNTIME_VERSION"), true);
    });

    it("should handle known source file extensions in pathToModuleUrl", () => {
      const result = getResult();
      assertEquals(result.includes("pages|components|app|lib|layouts|shared|features"), true);
    });

    it("should define setStudioEmbed function and expose on window", () => {
      const result = getResult();
      assertEquals(result.includes("function setStudioEmbed(value)"), true);
      assertEquals(result.includes("window.__veryfrontSetStudioEmbed = setStudioEmbed"), true);
    });

    it("should define setHMRRefreshTimestamp function and expose on window", () => {
      const result = getResult();
      assertEquals(result.includes("function setHMRRefreshTimestamp(timestamp)"), true);
      assertEquals(
        result.includes("window.__veryfrontSetHMRRefreshTimestamp = setHMRRefreshTimestamp"),
        true,
      );
    });

    it("should define async loadComponent function", () => {
      const result = getResult();
      assertEquals(result.includes("async function loadComponent(path)"), true);
    });

    it("should return null for empty path in loadComponent", () => {
      const result = getResult();
      assertEquals(result.includes("if (!path) return null"), true);
    });

    it("should use cache before loading in loadComponent", () => {
      const result = getResult();
      assertEquals(result.includes("componentCache.has(path)"), true);
      assertEquals(result.includes("componentCache.get(path)"), true);
    });

    it("should prefer MDXLayout over default export", () => {
      const result = getResult();
      assertEquals(
        result.includes("module.MDXLayout || module.MainLayout || module.default"),
        true,
      );
    });

    it("should include performance logging when DEBUG is enabled", () => {
      const result = getResult();
      assertEquals(result.includes("[Veryfront Perf]"), true);
    });

    it("should handle MODULE_SERVER_URL in pathToModuleUrl", () => {
      const result = getResult();
      assertEquals(result.includes("MODULE_SERVER_URL"), true);
    });

    it("version-stamps fallback module URLs when release id is configured", () => {
      const result = runGeneratedPathToModuleUrl(
        "pages/blog.mdx",
        "window.__veryfrontSetReleaseId('rel-1');",
      );

      assertEquals(
        result,
        `/_vf_modules/pages/blog.js?vf_release=rel-1&vf_runtime=${VERSION}`,
      );
    });

    it("does not version-stamp studio embed fallback module URLs", () => {
      const result = runGeneratedPathToModuleUrl(
        "pages/blog.mdx",
        "window.__veryfrontSetReleaseId('rel-1');",
        true,
      );

      assertEquals(result, "/_vf_modules/pages/blog.js?studio_embed=true");
    });

    it("does not version-stamp HMR fallback module URLs", () => {
      const result = runGeneratedPathToModuleUrl(
        "pages/blog.mdx",
        "window.__veryfrontSetReleaseId('rel-1'); window.__veryfrontSetHMRRefreshTimestamp('123');",
      );

      assertEquals(result, "/_vf_modules/pages/blog.js?t=123");
    });

    it("keeps release asset module URLs ahead of fallback release stamping", () => {
      const assetUrl = "/_vf/assets/" + "a".repeat(64) + ".js";
      const result = runGeneratedPathToModuleUrl(
        "pages/blog.mdx",
        `window.__veryfrontSetReleaseId('rel-1'); window.__veryfrontSetReleaseAssetModules({ 'pages/blog.mdx': '${assetUrl}' });`,
      );

      assertEquals(result, assetUrl);
    });
  });
});
