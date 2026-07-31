/**
 * Loading project page/layout modules from the module server, with the caches
 * and the release/Studio/HMR switches that decide which URL a path maps to.
 */

import { VERSION } from "#veryfront/utils/version-constant.ts";
import type { ModuleNamespace, PageDataPayload, RuntimeWindow } from "./env.ts";
import type { RuntimeLogging } from "./shared.ts";
import type { SnapshotModuleImporter } from "./snapshot-modules.ts";
import { isDependencySnapshotConflict } from "./snapshot-modules.ts";
import {
  appendDependencyPinningVersion,
  appendQueryParam,
  componentCacheKey,
  normalizeReleaseAssetModulePath,
} from "./module-urls.ts";

const VERYFRONT_RUNTIME_VERSION = VERSION;

export interface ComponentLoaderDeps {
  window: RuntimeWindow;
  logging: RuntimeLogging;
  moduleServerUrl: string;
  snapshotModules: SnapshotModuleImporter;
}

export interface ComponentLoader {
  loadComponent(
    path: string | undefined,
    moduleData?: PageDataPayload,
    options?: { allowDocumentReload?: boolean },
  ): Promise<unknown>;
  pathToModuleUrl(
    path: string,
    studioEmbed?: boolean,
    moduleData?: PageDataPayload,
  ): string;
  clearComponentCache(path?: string): void;
  setStudioEmbed(value: boolean): void;
  setReleaseId(value: string | null): void;
  setReleaseAssetModules(value: Record<string, string> | null): void;
  setHMRRefreshTimestamp(timestamp: string | null): void;
}

export function createComponentLoader(deps: ComponentLoaderDeps): ComponentLoader {
  const { window, moduleServerUrl } = deps;
  const { DEBUG, log, logError } = deps.logging;

  const componentCache = new Map<string, unknown>();
  const loadingPromises = new Map<string, Promise<unknown>>();

  let releaseId: string | null = null;
  let releaseAssetModules: Record<string, string> | null = null;
  let studioEmbed = false;
  let hmrRefreshTimestamp: string | null = null;

  function clearComponentCache(path?: string): void {
    if (!path) {
      componentCache.clear();
      loadingPromises.clear();
      log("Cleared all component caches");
      return;
    }

    for (const key of componentCache.keys()) {
      if (key === path || key.startsWith(path + "|vf_pins|")) {
        componentCache.delete(key);
      }
    }
    for (const key of loadingPromises.keys()) {
      if (key === path || key.startsWith(path + "|vf_pins|")) {
        loadingPromises.delete(key);
      }
    }
    log("Cleared component cache for:", path);
  }

  function setReleaseId(value: string | null): void {
    releaseId = typeof value === "string" && value ? value : null;
    window.__veryfrontReleaseId = releaseId;
  }

  function appendReleaseModuleVersion(url: string): string {
    if (!releaseId || url.includes("vf_release=")) return url;
    let versionedUrl = appendQueryParam(url, "vf_release", encodeURIComponent(releaseId));
    versionedUrl = appendQueryParam(
      versionedUrl,
      "vf_runtime",
      encodeURIComponent(VERYFRONT_RUNTIME_VERSION),
    );
    return versionedUrl;
  }

  function setReleaseAssetModules(value: Record<string, string> | null): void {
    releaseAssetModules = value && typeof value === "object" && !Array.isArray(value)
      ? value
      : null;
    window.__veryfrontReleaseAssetModules = releaseAssetModules;
  }

  /**
   * Release assets are content-addressed and immutable, so they win over every
   * other URL shape — but only outside Studio embed and HMR, where the point is
   * to serve freshly compiled modules instead.
   */
  function resolveReleaseAssetModuleUrl(path: string): string | null {
    if (!releaseAssetModules || studioEmbed || hmrRefreshTimestamp) return null;

    const key = normalizeReleaseAssetModulePath(path);
    if (releaseAssetModules[key]) return releaseAssetModules[key] as string;

    const withoutExt = key.replace(/\.(tsx|ts|jsx|mdx|js|mjs)$/, "");
    const extensions = [".tsx", ".ts", ".jsx", ".mdx", ".js"];
    for (const ext of extensions) {
      const candidate = withoutExt + ext;
      if (releaseAssetModules[candidate]) return releaseAssetModules[candidate] as string;
    }

    return null;
  }

  function pathToModuleUrl(
    path: string,
    embedInStudio?: boolean,
    moduleData?: PageDataPayload,
  ): string {
    const releaseAssetUrl = resolveReleaseAssetModuleUrl(path);
    if (releaseAssetUrl) return releaseAssetUrl;

    const pattern = /(pages|components|app|lib|layouts|shared|features)\/(.+)\.(tsx|ts|jsx|mdx)$/;

    const match = path.match(new RegExp("/" + pattern.source)) ||
      path.match(new RegExp("^" + pattern.source));

    let url;
    if (match) {
      url = moduleServerUrl + "/" + match[1] + "/" + match[2] + ".js";
    } else {
      const hasKnownExt = /\.(tsx|ts|jsx|mdx|js|mjs)$/.test(path);
      url = moduleServerUrl +
        "/" +
        (hasKnownExt ? path.replace(/\.(tsx|ts|jsx|mdx)$/, ".js") : path + ".js");
    }

    if (embedInStudio) url = appendQueryParam(url, "studio_embed", "true");
    if (hmrRefreshTimestamp) url = appendQueryParam(url, "t", hmrRefreshTimestamp);
    if (!embedInStudio && !hmrRefreshTimestamp) url = appendReleaseModuleVersion(url);
    url = appendDependencyPinningVersion(url, moduleData);

    return url;
  }

  function setStudioEmbed(value: boolean): void {
    studioEmbed = value;
    window.__veryfrontStudioEmbed = value;
  }

  function setHMRRefreshTimestamp(timestamp: string | null): void {
    hmrRefreshTimestamp = timestamp;
    window.__veryfrontHMRRefreshTimestamp = timestamp;
  }

  async function loadComponent(
    path: string | undefined,
    moduleData?: PageDataPayload,
    options: { allowDocumentReload?: boolean } = {},
  ): Promise<unknown> {
    if (!path) return null;

    const cacheKey = componentCacheKey(path, moduleData);
    if (componentCache.has(cacheKey)) {
      log("Component cached:", path);
      return componentCache.get(cacheKey);
    }

    const existingPromise = loadingPromises.get(cacheKey);
    if (existingPromise) return existingPromise;

    const loadPromise = (async () => {
      try {
        const moduleUrl = pathToModuleUrl(path, studioEmbed, moduleData);
        const start = DEBUG ? performance.now() : 0;

        log("Loading component:", moduleUrl);
        const module: ModuleNamespace = await deps.snapshotModules.importSnapshotBoundModule(
          moduleUrl,
          options.allowDocumentReload !== false,
        );

        // Prefer MDXLayout/MainLayout over default for MDX files. MDXContent
        // (the default export) overwrites the children prop; SSR resolves
        // mod.MDXLayout || mod.MainLayout || mod.default, so match it.
        const component = module.MDXLayout || module.MainLayout || module.default || module;

        if (DEBUG) {
          const duration = performance.now() - start;
          console.log(
            "[Veryfront Perf] %cimport:" + path.split("/").pop() + ": %c" + duration.toFixed(2) +
              "ms",
            "color: #888",
            duration > 50 ? "color: #f00; font-weight: bold" : "color: #0a0",
          );
        }

        componentCache.set(cacheKey, component);
        return component;
      } catch (error) {
        if (isDependencySnapshotConflict(error)) throw error;
        logError("Failed to load component:", path, error);
        return null;
      } finally {
        loadingPromises.delete(cacheKey);
      }
    })();

    loadingPromises.set(cacheKey, loadPromise);
    return loadPromise;
  }

  return {
    loadComponent,
    pathToModuleUrl,
    clearComponentCache,
    setStudioEmbed,
    setReleaseId,
    setReleaseAssetModules,
    setHMRRefreshTimestamp,
  };
}
