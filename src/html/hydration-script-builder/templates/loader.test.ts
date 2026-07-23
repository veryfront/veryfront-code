import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
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

  async function runGeneratedLoadComponent(
    path: string,
    setup = "",
  ): Promise<string[]> {
    const loadedPaths: string[] = [];
    const execute = new Function(
      "path",
      "loadedPaths",
      `
        const window = {};
        const MODULE_SERVER_URL = '/_vf_modules';
        const DEBUG = false;
        const logError = () => {};
        const performance = { now: () => 0 };
        ${getLoaderScript()}
        getComponentLoader = () => Promise.resolve({
          clearComponentCache() {},
          loadComponent(value) {
            loadedPaths.push(value);
            return null;
          }
        });
        ${setup}
        return loadComponent(path);
      `,
    );

    await execute(path, loadedPaths);
    return loadedPaths;
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

    it("delegates component loading to the bounded shared client loader", () => {
      const result = getResult();
      assertEquals(result.includes("/_veryfront/client/spa/component-loader.js"), true);
      assertEquals(result.includes("componentLoader.loadComponent(requestPath)"), true);
      assertEquals(result.includes("const componentCache = new Map()"), false);
      assertEquals(result.includes("const loadingPromises = new Map()"), false);
      assertEquals(result.includes("module.MDXLayout || module.MainLayout"), false);
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

    it("does not log raw component paths or module URLs", () => {
      const result = getResult();
      assertEquals(result.includes("Loading component:"), false);
      assertEquals(result.includes("Failed to load component:"), false);
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

    it("passes release versioning to the delegated component loader", async () => {
      const loadedPaths = await runGeneratedLoadComponent(
        "pages/blog.mdx",
        "window.__veryfrontSetReleaseId('rel-1');",
      );

      assertEquals(loadedPaths, [
        `pages/blog.mdx?vf_release=rel-1&vf_runtime=${VERSION}`,
      ]);
    });

    it("passes Studio and HMR cache busting to the delegated component loader", async () => {
      const studioPaths = await runGeneratedLoadComponent(
        "pages/blog.mdx",
        "window.__veryfrontSetStudioEmbed(true);",
      );
      const hmrPaths = await runGeneratedLoadComponent(
        "pages/blog.mdx",
        "window.__veryfrontSetHMRRefreshTimestamp('123');",
      );

      assertEquals(studioPaths, ["pages/blog.mdx?studio_embed=true"]);
      assertEquals(hmrPaths, ["pages/blog.mdx?t=123"]);
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

    it("snapshots release asset maps before exposing them to async loaders", () => {
      const assetUrl = "/_vf/assets/" + "a".repeat(64) + ".js";
      const result = runGeneratedPathToModuleUrl(
        "pages/blog.mdx",
        `
          const mutableMap = { 'pages/blog.mdx': '${assetUrl}' };
          window.__veryfrontSetReleaseAssetModules(mutableMap);
          mutableMap['pages/blog.mdx'] = 'javascript:alert(1)';
        `,
      );

      assertEquals(result, assetUrl);
    });

    it("ignores inherited release asset map properties", () => {
      const result = runGeneratedPathToModuleUrl(
        "pages/blog.mdx",
        `const inherited = Object.create({ 'pages/blog.mdx': 'https://evil.example/module.js' }); window.__veryfrontSetReleaseAssetModules(inherited);`,
      );

      assertEquals(result, "/_vf_modules/pages/blog.js");
    });

    it("rejects unsafe release asset URLs", () => {
      assertThrows(
        () =>
          runGeneratedPathToModuleUrl(
            "pages/blog.mdx",
            `window.__veryfrontSetReleaseAssetModules({ 'pages/blog.mdx': 'javascript:alert(1)' });`,
          ),
        TypeError,
        "Release asset URL",
      );
    });

    it("rejects traversal and encoded traversal module paths", () => {
      for (const path of ["../private.tsx", "pages/%2e%2e/private.tsx"]) {
        assertThrows(
          () => runGeneratedPathToModuleUrl(path),
          TypeError,
          "Module path",
        );
      }
    });

    it("rejects module paths containing unsafe URL characters", () => {
      assertThrows(
        () => runGeneratedPathToModuleUrl('pages/bad"><script>.tsx'),
        TypeError,
        "Module path",
      );
    });

    it("rejects raw and percent-encoded control characters in module paths", () => {
      for (
        const path of [
          "pages/bad\nname.tsx",
          "pages/%0aname.tsx",
          "pages/%c2%85.tsx",
          "pages/encoded%3fquery.tsx",
          "pages/encoded%23fragment.tsx",
          "pages/invalid-\ud800.tsx",
        ]
      ) {
        assertThrows(
          () => runGeneratedPathToModuleUrl(path),
          TypeError,
          "Module path",
        );
      }
    });

    it("rejects malformed root-relative release asset hashes", () => {
      assertThrows(
        () =>
          runGeneratedPathToModuleUrl(
            "pages/blog.mdx",
            `window.__veryfrontSetReleaseAssetModules({ 'pages/blog.mdx': '/_vf/assets/not-a-hash.js' });`,
          ),
        TypeError,
        "Release asset URL",
      );
    });
  });
});
