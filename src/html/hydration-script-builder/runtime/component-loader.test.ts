import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { VERSION } from "#veryfront/utils/version-constant.ts";
import type { ModuleNamespace, RuntimeWindow } from "./env.ts";
import type { RuntimeLogging } from "./shared.ts";
import type { SnapshotModuleImporter } from "./snapshot-modules.ts";
import { type ComponentLoader, createComponentLoader } from "./component-loader.ts";

const MODULE_SERVER_URL = "/_vf_modules";

function silentLogging(): RuntimeLogging {
  return {
    DEBUG: false,
    log: () => {},
    logError: () => {},
    logBackgroundFetchFailure: () => {},
    perfStart: () => {},
    perfEnd: () => 0,
  };
}

interface LoaderHarness {
  loader: ComponentLoader;
  window: RuntimeWindow;
  importedUrls: string[];
  reloadRequests: string[];
}

function createLoaderHarness(
  importSnapshotBoundModule?: (
    moduleUrl: string,
    allowDocumentReload?: boolean,
  ) => Promise<ModuleNamespace>,
): LoaderHarness {
  const importedUrls: string[] = [];
  const reloadRequests: string[] = [];
  const window = {} as unknown as RuntimeWindow;

  const snapshotModules: SnapshotModuleImporter = {
    importSnapshotBoundModule: (moduleUrl, allowDocumentReload) => {
      importedUrls.push(moduleUrl);
      if (allowDocumentReload) reloadRequests.push(moduleUrl);
      if (importSnapshotBoundModule) {
        return importSnapshotBoundModule(moduleUrl, allowDocumentReload);
      }
      return Promise.resolve({ default: { name: "Component:" + moduleUrl } });
    },
    recoverFromSnapshotBoundModuleFailure: () => Promise.resolve(false),
  };

  const loader = createComponentLoader({
    window,
    logging: silentLogging(),
    moduleServerUrl: MODULE_SERVER_URL,
    snapshotModules,
  });

  return { loader, window, importedUrls, reloadRequests };
}

describe("hydration-script-builder/runtime/component-loader", () => {
  describe("pathToModuleUrl", () => {
    it("maps a recognised source directory to a module-server URL", () => {
      const { loader } = createLoaderHarness();
      assertEquals(loader.pathToModuleUrl("pages/blog.mdx"), "/_vf_modules/pages/blog.js");
      assertEquals(
        loader.pathToModuleUrl("project/app/layout.tsx"),
        "/_vf_modules/app/layout.js",
      );
    });

    it("falls back to the raw path for unrecognised directories", () => {
      const { loader } = createLoaderHarness();
      assertEquals(loader.pathToModuleUrl("custom/thing.tsx"), "/_vf_modules/custom/thing.js");
      assertEquals(loader.pathToModuleUrl("extensionless"), "/_vf_modules/extensionless.js");
    });

    it("version-stamps fallback module URLs when release id is configured", () => {
      const { loader } = createLoaderHarness();
      loader.setReleaseId("rel-1");

      assertEquals(
        loader.pathToModuleUrl("pages/blog.mdx"),
        `/_vf_modules/pages/blog.js?vf_release=rel-1&vf_runtime=${VERSION}`,
      );
    });

    it("does not version-stamp studio embed fallback module URLs", () => {
      const { loader } = createLoaderHarness();
      loader.setReleaseId("rel-1");

      assertEquals(
        loader.pathToModuleUrl("pages/blog.mdx", true),
        "/_vf_modules/pages/blog.js?studio_embed=true",
      );
    });

    it("does not version-stamp HMR fallback module URLs", () => {
      const { loader } = createLoaderHarness();
      loader.setReleaseId("rel-1");
      loader.setHMRRefreshTimestamp("123");

      assertEquals(loader.pathToModuleUrl("pages/blog.mdx"), "/_vf_modules/pages/blog.js?t=123");
    });

    it("pins mutable Pages Router module URLs to the rendered dependency snapshot", () => {
      const { loader } = createLoaderHarness();

      assertEquals(
        loader.pathToModuleUrl("pages/blog.mdx", false, {
          dependencyPinningCacheKey: "on:sha-a",
        }),
        "/_vf_modules/_pins/on%3Asha-a/pages/blog.js",
      );
    });

    it("keeps page and layout child resolution inside the path snapshot", () => {
      const { loader } = createLoaderHarness();

      for (const path of ["pages/blog.mdx", "app/layout.tsx"]) {
        const entry = loader.pathToModuleUrl(path, false, {
          dependencyPinningCacheKey: "on:sha-a",
        });
        const child = new URL("./child.js", `https://app.example${entry}`);
        assertEquals(child.pathname.includes("/_vf_modules/_pins/on%3Asha-a/"), true);
        assertEquals(child.searchParams.has("pins"), false);
      }
    });

    it("preserves flag-off Pages Router module URLs", () => {
      const { loader } = createLoaderHarness();

      assertEquals(
        loader.pathToModuleUrl("pages/blog.mdx", false, { dependencyPinningCacheKey: "off" }),
        "/_vf_modules/pages/blog.js",
      );
    });

    it("does not add dependency pins to content-addressed release assets", () => {
      const assetUrl = "/_vf/assets/" + "b".repeat(64) + ".js";
      const { loader } = createLoaderHarness();
      loader.setReleaseAssetModules({ "pages/blog.mdx": assetUrl });

      assertEquals(
        loader.pathToModuleUrl("pages/blog.mdx", false, {
          dependencyPinningCacheKey: "on:sha-a",
        }),
        assetUrl,
      );
    });

    it("keeps release asset module URLs ahead of fallback release stamping", () => {
      const assetUrl = "/_vf/assets/" + "a".repeat(64) + ".js";
      const { loader } = createLoaderHarness();
      loader.setReleaseId("rel-1");
      loader.setReleaseAssetModules({ "pages/blog.mdx": assetUrl });

      assertEquals(loader.pathToModuleUrl("pages/blog.mdx"), assetUrl);
    });

    it("resolves a release asset recorded under a different source extension", () => {
      const assetUrl = "/_vf/assets/" + "c".repeat(64) + ".js";
      const { loader } = createLoaderHarness();
      loader.setReleaseAssetModules({ "pages/blog.tsx": assetUrl });

      assertEquals(loader.pathToModuleUrl("pages/blog.mdx"), assetUrl);
    });

    it("ignores release assets while HMR is serving fresh modules", () => {
      const assetUrl = "/_vf/assets/" + "d".repeat(64) + ".js";
      const { loader } = createLoaderHarness();
      loader.setReleaseAssetModules({ "pages/blog.mdx": assetUrl });
      loader.setHMRRefreshTimestamp("77");

      assertEquals(loader.pathToModuleUrl("pages/blog.mdx"), "/_vf_modules/pages/blog.js?t=77");
    });

    it("ignores release assets while Studio embed is serving fresh modules", () => {
      const assetUrl = "/_vf/assets/" + "e".repeat(64) + ".js";
      const { loader } = createLoaderHarness();
      loader.setReleaseAssetModules({ "pages/blog.mdx": assetUrl });
      loader.setStudioEmbed(true);

      assertEquals(
        loader.pathToModuleUrl("pages/blog.mdx"),
        "/_vf_modules/pages/blog.js",
        "studio embed must bypass immutable release assets so Studio edits appear",
      );
      assertEquals(
        loader.pathToModuleUrl("pages/blog.mdx", true),
        "/_vf_modules/pages/blog.js?studio_embed=true",
        "an explicit studio-embed request must also bypass release assets",
      );
    });
  });

  describe("release and embed switches", () => {
    it("mirrors its state onto window for the dev tooling that reads it", () => {
      const { loader, window } = createLoaderHarness();

      loader.setReleaseId("rel-9");
      loader.setStudioEmbed(true);
      loader.setHMRRefreshTimestamp("42");
      loader.setReleaseAssetModules({ "a.tsx": "/_vf/assets/a.js" });

      assertEquals(window.__veryfrontReleaseId, "rel-9");
      assertEquals(window.__veryfrontStudioEmbed, true);
      assertEquals(window.__veryfrontHMRRefreshTimestamp, "42");
      assertEquals(window.__veryfrontReleaseAssetModules, { "a.tsx": "/_vf/assets/a.js" });
    });

    it("treats an empty release id and a non-object asset map as absent", () => {
      const { loader, window } = createLoaderHarness();

      loader.setReleaseId("");
      loader.setReleaseAssetModules([] as unknown as Record<string, string>);

      assertEquals(window.__veryfrontReleaseId, null);
      assertEquals(window.__veryfrontReleaseAssetModules, null);
    });
  });

  describe("loadComponent", () => {
    it("returns null for an empty path", async () => {
      const { loader, importedUrls } = createLoaderHarness();
      assertEquals(await loader.loadComponent(undefined), null);
      assertEquals(importedUrls, []);
    });

    it("loads pinned components through snapshot recovery", async () => {
      const component = { name: "PinnedLayout" };
      const { loader, importedUrls } = createLoaderHarness(() =>
        Promise.resolve({ default: component })
      );

      const loaded = await loader.loadComponent("app/layout.tsx", {
        dependencyPinningCacheKey: "on:sha-a",
      });

      assertEquals(loaded, component);
      assertEquals(importedUrls, ["/_vf_modules/_pins/on%3Asha-a/app/layout.js"]);
    });

    it("prefers MDXLayout, then MainLayout, then the default export", async () => {
      const mdx = { name: "mdx" };
      const main = { name: "main" };
      const fallback = { name: "default" };

      const withAll = createLoaderHarness(() =>
        Promise.resolve({ MDXLayout: mdx, MainLayout: main, default: fallback })
      );
      assertEquals(await withAll.loader.loadComponent("pages/a.mdx"), mdx);

      const withMain = createLoaderHarness(() =>
        Promise.resolve({ MainLayout: main, default: fallback })
      );
      assertEquals(await withMain.loader.loadComponent("pages/a.mdx"), main);

      const withDefault = createLoaderHarness(() => Promise.resolve({ default: fallback }));
      assertEquals(await withDefault.loader.loadComponent("pages/a.mdx"), fallback);
    });

    it("serves a second load of the same path from the cache", async () => {
      const { loader, importedUrls } = createLoaderHarness();

      const first = await loader.loadComponent("pages/a.tsx");
      const second = await loader.loadComponent("pages/a.tsx");

      assertEquals(first, second);
      assertEquals(importedUrls.length, 1);
    });

    it("caches per dependency snapshot so two snapshots cannot share a component", async () => {
      const { loader, importedUrls } = createLoaderHarness();

      await loader.loadComponent("pages/a.tsx", { dependencyPinningCacheKey: "on:sha-a" });
      await loader.loadComponent("pages/a.tsx", { dependencyPinningCacheKey: "on:sha-b" });
      await loader.loadComponent("pages/a.tsx", { dependencyPinningCacheKey: "on:sha-a" });

      assertEquals(importedUrls, [
        "/_vf_modules/_pins/on%3Asha-a/pages/a.js",
        "/_vf_modules/_pins/on%3Asha-b/pages/a.js",
      ]);
    });

    it("shares one in-flight import between concurrent loads", async () => {
      let resolveImport: ((module: ModuleNamespace) => void) | undefined;
      const { loader, importedUrls } = createLoaderHarness(() =>
        new Promise<ModuleNamespace>((resolve) => {
          resolveImport = resolve;
        })
      );

      const first = loader.loadComponent("pages/a.tsx");
      const second = loader.loadComponent("pages/a.tsx");
      resolveImport?.({ default: { name: "Shared" } });

      assertEquals(await first, await second);
      assertEquals(importedUrls.length, 1);
    });

    it("returns null and keeps going when a module fails to load", async () => {
      const { loader } = createLoaderHarness(() => Promise.reject(new Error("boom")));

      assertEquals(await loader.loadComponent("pages/a.tsx"), null);
    });

    it("rethrows a dependency snapshot conflict so the caller can drop its cache", async () => {
      const conflict = Object.assign(new Error("snapshot gone"), {
        dependencySnapshotConflict: true,
      });
      const { loader } = createLoaderHarness(() => Promise.reject(conflict));

      let thrown: unknown;
      try {
        await loader.loadComponent("pages/a.tsx");
      } catch (error) {
        thrown = error;
      }

      assertEquals(thrown, conflict);
    });

    it("forwards allowDocumentReload:false so a speculative load cannot reload the page", async () => {
      const { loader, reloadRequests, importedUrls } = createLoaderHarness();

      await loader.loadComponent("pages/default.tsx");
      assertEquals(
        reloadRequests,
        ["/_vf_modules/pages/default.js"],
        "a foreground load must permit document-reload recovery",
      );

      await loader.loadComponent("pages/a.tsx", undefined, { allowDocumentReload: false });

      assertEquals(importedUrls.length, 2);
      assertEquals(
        reloadRequests,
        ["/_vf_modules/pages/default.js"],
        "allowDocumentReload:false must not request a document reload",
      );
    });

    it("clears one path or the whole cache", async () => {
      const { loader, importedUrls } = createLoaderHarness();

      await loader.loadComponent("pages/a.tsx", { dependencyPinningCacheKey: "on:sha-a" });
      await loader.loadComponent("pages/b.tsx");
      loader.clearComponentCache("pages/a.tsx");

      await loader.loadComponent("pages/a.tsx", { dependencyPinningCacheKey: "on:sha-a" });
      await loader.loadComponent("pages/b.tsx");
      assertEquals(importedUrls.length, 3);

      loader.clearComponentCache();
      await loader.loadComponent("pages/b.tsx");
      assertEquals(importedUrls.length, 4);
    });
  });
});
