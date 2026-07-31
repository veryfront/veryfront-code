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
    moduleDataOrPreferRscModule?:
      | boolean
      | { dependencyPinningCacheKey?: string },
    releaseAssetModules?: Record<string, string> | null,
    releaseId?: string | null,
  ): string {
    const preferRscModule = typeof moduleDataOrPreferRscModule === "boolean"
      ? moduleDataOrPreferRscModule
      : undefined;
    const moduleData = typeof moduleDataOrPreferRscModule === "object"
      ? moduleDataOrPreferRscModule
      : undefined;
    const globalRecord = globalThis as MutableTestGlobal;
    const previousWindow = globalRecord.window;
    const previousReleaseId = globalRecord.__veryfrontReleaseId;
    const previousReleaseAssetModules = globalRecord.__veryfrontReleaseAssetModules;

    globalRecord.window = globalThis;

    try {
      return new Function(
        "path",
        "studioEmbed",
        "moduleData",
        "preferRscModule",
        "releaseAssetModules",
        "releaseId",
        `const MODULE_SERVER_URL = '/_vf_modules';
${getLoaderScript()}
${setup}
return preferRscModule === undefined
  ? pathToModuleUrl(path, studioEmbed, moduleData)
  : resolveHydrationModuleUrl(
      path,
      preferRscModule,
      studioEmbed,
      moduleData,
      releaseAssetModules,
      releaseId,
    );`,
      )(
        path,
        studioEmbed,
        moduleData,
        preferRscModule,
        releaseAssetModules,
        releaseId,
      ) as string;
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

  function evaluateLoaderRuntime(maxCacheSize: number): {
    load(path: string, moduleUrl: string): Promise<unknown>;
    clear(path?: string): void;
    cachedValues(): unknown[];
  } {
    const script = getLoaderScript().replace(
      "const MAX_COMPONENT_CACHE_SIZE = 500;",
      `const MAX_COMPONENT_CACHE_SIZE = ${maxCacheSize};`,
    );
    const testWindow: Record<string, unknown> = {};
    const runtime = new Function(
      "window",
      `const MODULE_SERVER_URL = '/_vf_modules';
const DEBUG = false;
const log = () => {};
const logError = () => {};
const importSnapshotBoundModule = (url) => import(url);
${script}
return {
  load: loadComponentFromUrl,
  clear: clearComponentCache,
  cachedValues: () => [...componentCache.values()],
};`,
    )(testWindow) as {
      load(path: string, moduleUrl: string): Promise<unknown>;
      clear(path?: string): void;
      cachedValues(): unknown[];
    };
    return runtime;
  }

  function dataModule(value: string): string {
    return `data:text/javascript,export%20default%20${encodeURIComponent(JSON.stringify(value))}`;
  }

  function runGeneratedDependencyPinning(
    url: string,
    dependencyPinningCacheKey: string,
  ): string {
    const globalRecord = globalThis as MutableTestGlobal;
    const previousWindow = globalRecord.window;
    globalRecord.window = globalThis;

    try {
      return new Function(
        "url",
        "moduleData",
        `const MODULE_SERVER_URL = '/_vf_modules';\n${getLoaderScript()}\n` +
          `return appendDependencyPinningVersion(url, moduleData);`,
      )(url, { dependencyPinningCacheKey }) as string;
    } finally {
      if (previousWindow === undefined) {
        delete globalRecord.window;
      } else {
        globalRecord.window = previousWindow;
      }
    }
  }

  async function runGeneratedLoadComponent(
    path: string,
    moduleData: { dependencyPinningCacheKey?: string },
    importSnapshotBoundModule: (moduleUrl: string) => Promise<unknown>,
  ): Promise<unknown> {
    const globalRecord = globalThis as MutableTestGlobal;
    const previousWindow = globalRecord.window;
    globalRecord.window = globalThis;

    try {
      return await new Function(
        "path",
        "moduleData",
        "importSnapshotBoundModule",
        `const MODULE_SERVER_URL = '/_vf_modules';
        const DEBUG = false;
        const log = () => {};
        const logError = () => {};
        ${getLoaderScript()}
        return loadComponent(path, moduleData);`,
      )(path, moduleData, importSnapshotBoundModule) as unknown;
    } finally {
      if (previousWindow === undefined) {
        delete globalRecord.window;
      } else {
        globalRecord.window = previousWindow;
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
      assertEquals(result.includes("function pathToModuleUrl("), true);
      assertEquals(
        result.includes("      moduleData,\n      releaseAssetModules"),
        true,
      );
    });

    it("should expose release asset module map support", () => {
      const result = getResult();
      assertEquals(result.includes("let __releaseAssetModules = null"), true);
      assertEquals(
        result.includes("window.__veryfrontSetReleaseAssetModules = setReleaseAssetModules"),
        true,
      );
      assertEquals(result.includes("function resolveReleaseAssetModuleUrl("), true);
    });

    it("should expose release id support for immutable fallback module URLs", () => {
      const result = getResult();
      assertEquals(result.includes("window.__veryfrontSetReleaseId = setReleaseId"), true);
      assertEquals(result.includes("function appendReleaseModuleVersion("), true);
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
      assertEquals(
        result.includes("async function loadComponent(path, moduleData, options = {})"),
        true,
      );
    });

    it("loads pinned components through snapshot recovery", async () => {
      const importedUrls: string[] = [];
      const component = { name: "PinnedLayout" };

      const loaded = await runGeneratedLoadComponent(
        "app/layout.tsx",
        { dependencyPinningCacheKey: "on:sha-a" },
        (moduleUrl) => {
          importedUrls.push(moduleUrl);
          return Promise.resolve({ default: component });
        },
      );

      assertEquals(loaded, component);
      assertEquals(importedUrls, [
        "/_vf_modules/_pins/on%3Asha-a/app/layout.tsx",
      ]);
    });

    it("should return null for empty path in loadComponent", () => {
      const result = getResult();
      assertEquals(result.includes("if (!path) return null"), true);
    });

    it("should use cache before loading in loadComponent", () => {
      const result = getResult();
      assertEquals(result.includes("componentCache.has(cacheKey)"), true);
      assertEquals(result.includes("componentCache.get(cacheKey)"), true);
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
        `/_vf_modules/pages/blog.mdx?vf_release=rel-1&vf_runtime=${VERSION}`,
      );
    });

    it("does not version-stamp studio embed fallback module URLs", () => {
      const result = runGeneratedPathToModuleUrl(
        "pages/blog.mdx",
        "window.__veryfrontSetReleaseId('rel-1');",
        true,
      );

      assertEquals(result, "/_vf_modules/pages/blog.mdx?studio_embed=true");
    });

    it("does not version-stamp HMR fallback module URLs", () => {
      const result = runGeneratedPathToModuleUrl(
        "pages/blog.mdx",
        "window.__veryfrontSetReleaseId('rel-1'); window.__veryfrontSetHMRRefreshTimestamp('123');",
      );

      assertEquals(result, "/_vf_modules/pages/blog.mdx?t=123");
    });

    it("pins mutable Pages Router module URLs to the rendered dependency snapshot", () => {
      const result = runGeneratedPathToModuleUrl(
        "pages/blog.mdx",
        "",
        false,
        { dependencyPinningCacheKey: "on:sha-a" },
      );

      assertEquals(
        result,
        "/_vf_modules/_pins/on%3Asha-a/pages/blog.mdx",
      );
    });

    it("replaces stale path tokens while preserving release, HMR, and hash state", () => {
      assertEquals(
        runGeneratedDependencyPinning(
          "/_vf_modules/_pins/on%3Astale/pages/blog.js?vf_release=rel-1&t=123&pins=on%3Astale#entry",
          "on:sha-a",
        ),
        "/_vf_modules/_pins/on%3Asha-a/pages/blog.js?vf_release=rel-1&t=123#entry",
      );
      assertEquals(
        runGeneratedDependencyPinning(
          "/_vf_modules/_pins/project-dir/blog.js",
          "on:sha-a",
        ),
        "/_vf_modules/_pins/on%3Asha-a/_pins/project-dir/blog.js",
      );
    });

    it("keeps page and layout child resolution inside the path snapshot", () => {
      for (const path of ["pages/blog.mdx", "app/layout.tsx"]) {
        const entry = runGeneratedPathToModuleUrl(
          path,
          "",
          false,
          { dependencyPinningCacheKey: "on:sha-a" },
        );
        const child = new URL("./child.js", `https://app.example${entry}`);
        assertEquals(
          child.pathname.includes("/_vf_modules/_pins/on%3Asha-a/"),
          true,
        );
        assertEquals(child.searchParams.has("pins"), false);
      }
    });

    it("preserves flag-off Pages Router module URLs", () => {
      const result = runGeneratedPathToModuleUrl(
        "pages/blog.mdx",
        "",
        false,
        { dependencyPinningCacheKey: "off" },
      );

      assertEquals(result, "/_vf_modules/pages/blog.mdx");
    });

    it("does not add dependency pins to content-addressed release assets", () => {
      const assetUrl = "/_vf/assets/" + "b".repeat(64) + ".js";
      const result = runGeneratedPathToModuleUrl(
        "pages/blog.mdx",
        `window.__veryfrontSetReleaseAssetModules({ 'pages/blog.mdx': '${assetUrl}' });`,
        false,
        { dependencyPinningCacheKey: "on:sha-a" },
      );

      assertEquals(result, assetUrl);
    });

    it("keeps release asset module URLs ahead of fallback release stamping", () => {
      const assetUrl = "/_vf/assets/" + "a".repeat(64) + ".js";
      const result = runGeneratedPathToModuleUrl(
        "pages/blog.mdx",
        `window.__veryfrontSetReleaseId('rel-1'); window.__veryfrontSetReleaseAssetModules({ 'pages/blog.mdx': '${assetUrl}' });`,
      );

      assertEquals(result, assetUrl);
    });

    it("never aliases an explicitly requested extension to a sibling source file", () => {
      const wrongAssetUrl = "/_vf/assets/" + "b".repeat(64) + ".js";
      const result = runGeneratedPathToModuleUrl(
        "app/page.tsx",
        `window.__veryfrontSetReleaseAssetModules({ 'app/page.ts': '${wrongAssetUrl}' });`,
      );

      assertEquals(result, "/_vf_modules/app/page.tsx");
    });

    it("ignores inherited release-map properties", () => {
      const inheritedAssetUrl = "/_vf/assets/" + "f".repeat(64) + ".js";
      const result = runGeneratedPathToModuleUrl(
        "app/page.tsx",
        `const inheritedMap = Object.create({ 'app/page.tsx': '${inheritedAssetUrl}' });
window.__veryfrontSetReleaseAssetModules(inheritedMap);`,
      );

      assertEquals(result, "/_vf_modules/app/page.tsx");
    });

    it("keeps authored JavaScript distinct from the legacy extensionless endpoint", () => {
      assertEquals(
        runGeneratedPathToModuleUrl("app/page.js"),
        "/_vf_modules/app/page.js.js",
      );
      assertEquals(
        runGeneratedPathToModuleUrl("app/page"),
        "/_vf_modules/app/page.js",
      );
    });

    it("expands source variants only for extensionless logical paths", () => {
      const assetUrl = "/_vf/assets/" + "c".repeat(64) + ".js";
      const result = runGeneratedPathToModuleUrl(
        "app/page",
        `window.__veryfrontSetReleaseAssetModules({ 'app/page.ts': '${assetUrl}' });`,
      );

      assertEquals(result, assetUrl);
    });

    it("normalizes query and hash suffixes without weakening exact extension identity", () => {
      const exactAssetUrl = "/_vf/assets/" + "d".repeat(64) + ".js";
      const result = runGeneratedPathToModuleUrl(
        "/app/page.tsx?cache=1#section",
        `window.__veryfrontSetReleaseAssetModules({ 'app/page.tsx': '${exactAssetUrl}', 'app/page.ts': '/wrong.js' });`,
      );

      assertEquals(result, exactAssetUrl);
    });

    it("selects transport independently for full, partial, and unrelated release maps", () => {
      const pageAsset = "/_vf/assets/" + "e".repeat(64) + ".js";
      const setup =
        `window.__veryfrontSetReleaseAssetModules({ 'app/page.tsx': '${pageAsset}', 'app/unrelated.tsx': '/unrelated.js' });`;

      assertEquals(
        runGeneratedPathToModuleUrl("app/page.tsx", setup, false, true),
        pageAsset,
      );
      assertEquals(
        runGeneratedPathToModuleUrl("app/layout.tsx", setup, false, true),
        "/_veryfront/rsc/module?rel=app%2Flayout.tsx",
      );
      assertEquals(
        runGeneratedPathToModuleUrl("pages/about.tsx", setup, false, false),
        "/_vf_modules/pages/about.tsx",
      );
    });

    it("resolves an explicit page-data release without mutating the active release", () => {
      const explicitAsset = "/_vf/assets/" + "1".repeat(64) + ".js";
      const result = runGeneratedPathToModuleUrl(
        "app/page.tsx",
        "window.__veryfrontSetReleaseId('active'); window.__veryfrontSetReleaseAssetModules({});",
        false,
        false,
        { "app/page.tsx": explicitAsset },
        "prefetched",
      );

      assertEquals(result, explicitAsset);
    });

    it("uses true LRU eviction for the bounded component cache", async () => {
      const runtime = evaluateLoaderRuntime(2);
      await runtime.load("a.tsx", dataModule("a"));
      await runtime.load("b.tsx", dataModule("b"));
      await runtime.load("a.tsx", dataModule("a"));
      await runtime.load("c.tsx", dataModule("c"));

      assertEquals(runtime.cachedValues(), ["a", "c"]);
    });

    it("does not repopulate the cache from an import invalidated while in flight", async () => {
      const runtime = evaluateLoaderRuntime(2);
      const pending = runtime.load("stale.tsx", dataModule("stale"));

      runtime.clear("stale.tsx");
      assertEquals(await pending, "stale");
      assertEquals(runtime.cachedValues(), []);
    });
  });
});
