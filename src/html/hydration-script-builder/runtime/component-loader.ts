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
  buildPinnedRscModuleUrl,
  normalizeReleaseAssetModulePath,
} from "./module-urls.ts";

const VERYFRONT_RUNTIME_VERSION = VERSION;
const MAX_COMPONENT_CACHE_SIZE = 500;

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
    releaseAssetModules?: Record<string, string> | null,
    releaseId?: string | null,
  ): string;
  resolveHydrationModuleUrl(
    path: string,
    preferRscModule: boolean,
    studioEmbed?: boolean,
    moduleData?: PageDataPayload,
    releaseAssetModules?: Record<string, string> | null,
    releaseId?: string | null,
  ): string;
  loadComponentFromUrl(
    path: string,
    moduleUrl: string,
    options?: { allowDocumentReload?: boolean },
  ): Promise<unknown>;
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
  const componentCachePaths = new Map<string, string>();
  const loadingPromises = new Map<string, Promise<unknown>>();
  let componentCacheGeneration = 0;

  let releaseId: string | null = null;
  let releaseAssetModules: Record<string, string> | null = null;
  let studioEmbed = false;
  let hmrRefreshTimestamp: string | null = null;

  function clearComponentCache(path?: string): void {
    componentCacheGeneration++;
    if (!path) {
      componentCache.clear();
      componentCachePaths.clear();
      loadingPromises.clear();
      log("Cleared all component caches");
      return;
    }

    for (const [cacheKey, cachedPath] of componentCachePaths) {
      if (cachedPath !== path) continue;
      componentCache.delete(cacheKey);
      componentCachePaths.delete(cacheKey);
      loadingPromises.delete(cacheKey);
    }
    log("Cleared component cache for:", path);
  }

  function setReleaseId(value: string | null): void {
    releaseId = typeof value === "string" && value ? value : null;
    window.__veryfrontReleaseId = releaseId;
  }

  function appendReleaseModuleVersion(url: string, activeReleaseId = releaseId): string {
    if (!activeReleaseId || url.includes("vf_release=")) return url;
    let versionedUrl = appendQueryParam(
      url,
      "vf_release",
      encodeURIComponent(activeReleaseId),
    );
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
  function readOwnReleaseAssetModuleUrl(
    moduleMap: Record<string, string>,
    path: string,
  ): string | null {
    try {
      if (!Object.prototype.hasOwnProperty.call(moduleMap, path)) return null;
      const value = moduleMap[path];
      return typeof value === "string" && value ? value : null;
    } catch (_) {
      return null;
    }
  }

  function resolveReleaseAssetModuleUrl(
    path: string,
    moduleMap = releaseAssetModules,
    embedInStudio = studioEmbed,
  ): string | null {
    if (!moduleMap || embedInStudio || hmrRefreshTimestamp) return null;

    const key = normalizeReleaseAssetModulePath(path);
    const exactUrl = readOwnReleaseAssetModuleUrl(moduleMap, key);
    if (exactUrl) return exactUrl;

    if (/\.(tsx|ts|jsx|mdx|md|js|mjs)$/.test(key)) return null;

    const extensions = [".tsx", ".ts", ".jsx", ".mdx", ".md", ".js", ".mjs"];
    for (const ext of extensions) {
      const candidateUrl = readOwnReleaseAssetModuleUrl(moduleMap, key + ext);
      if (candidateUrl) return candidateUrl;
    }

    return null;
  }

  function pathToModuleUrl(
    path: string,
    embedInStudio?: boolean,
    moduleData?: PageDataPayload,
    activeReleaseAssetModules = releaseAssetModules,
    activeReleaseId = releaseId,
  ): string {
    const releaseAssetUrl = resolveReleaseAssetModuleUrl(
      path,
      activeReleaseAssetModules,
      embedInStudio,
    );
    if (releaseAssetUrl) return releaseAssetUrl;

    const normalizedPath = normalizeReleaseAssetModulePath(path);
    const pattern =
      /(pages|components|app|lib|layouts|shared|features)\/(.+)\.(tsx|ts|jsx|mdx|md|js|mjs)$/;

    const match = normalizedPath.match(new RegExp("/" + pattern.source)) ||
      normalizedPath.match(new RegExp("^" + pattern.source));

    const logicalPath = match ? match[1] + "/" + match[2] + "." + match[3] : normalizedPath;
    const hasSourceExt = /\.(tsx|ts|jsx|mdx|md|js|mjs)$/.test(logicalPath);
    const requestPath = /\.(js|mjs)$/.test(logicalPath)
      ? logicalPath + ".js"
      : hasSourceExt
      ? logicalPath
      : logicalPath + ".js";
    let url = moduleServerUrl + "/" + requestPath;

    if (embedInStudio) url = appendQueryParam(url, "studio_embed", "true");
    if (hmrRefreshTimestamp) url = appendQueryParam(url, "t", hmrRefreshTimestamp);
    if (!embedInStudio && !hmrRefreshTimestamp) {
      url = appendReleaseModuleVersion(url, activeReleaseId);
    }
    url = appendDependencyPinningVersion(url, moduleData);

    return url;
  }

  function resolveHydrationModuleUrl(
    path: string,
    preferRscModule: boolean,
    embedInStudio?: boolean,
    moduleData?: PageDataPayload,
    activeReleaseAssetModules = moduleData?.releaseAssetModules ?? releaseAssetModules,
    activeReleaseId = moduleData?.releaseId ?? releaseId,
  ): string {
    const releaseAssetUrl = resolveReleaseAssetModuleUrl(
      path,
      activeReleaseAssetModules,
      embedInStudio,
    );
    if (releaseAssetUrl) return releaseAssetUrl;
    if (preferRscModule) return buildPinnedRscModuleUrl(path, moduleData);
    return pathToModuleUrl(
      path,
      embedInStudio,
      moduleData,
      activeReleaseAssetModules,
      activeReleaseId,
    );
  }

  function setStudioEmbed(value: boolean): void {
    studioEmbed = value;
    window.__veryfrontStudioEmbed = value;
  }

  function setHMRRefreshTimestamp(timestamp: string | null): void {
    hmrRefreshTimestamp = timestamp;
    window.__veryfrontHMRRefreshTimestamp = timestamp;
  }

  async function loadComponentFromUrl(
    path: string,
    moduleUrl: string,
    options: { allowDocumentReload?: boolean } = {},
  ): Promise<unknown> {
    if (!path || !moduleUrl) return null;
    const cacheKey = path + "\0" + moduleUrl;
    if (componentCache.has(cacheKey)) {
      log("Component cached:", path);
      const component = componentCache.get(cacheKey);
      componentCache.delete(cacheKey);
      componentCache.set(cacheKey, component);
      return component;
    }

    const existingPromise = loadingPromises.get(cacheKey);
    if (existingPromise) return existingPromise;

    const cacheGeneration = componentCacheGeneration;
    const loadState: { promise?: Promise<unknown> } = {};
    const loadPromise = (async () => {
      try {
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

        if (cacheGeneration === componentCacheGeneration) {
          if (componentCache.size >= MAX_COMPONENT_CACHE_SIZE) {
            const oldestKey = componentCache.keys().next().value;
            if (oldestKey !== undefined) {
              componentCache.delete(oldestKey);
              componentCachePaths.delete(oldestKey);
            }
          }
          componentCache.set(cacheKey, component);
          componentCachePaths.set(cacheKey, path);
        }
        return component;
      } catch (error) {
        if (isDependencySnapshotConflict(error)) throw error;
        logError("Failed to load component:", path, error);
        return null;
      } finally {
        if (loadingPromises.get(cacheKey) === loadState.promise) {
          loadingPromises.delete(cacheKey);
          if (!componentCache.has(cacheKey)) componentCachePaths.delete(cacheKey);
        }
      }
    })();
    loadState.promise = loadPromise;

    loadingPromises.set(cacheKey, loadPromise);
    componentCachePaths.set(cacheKey, path);
    return loadPromise;
  }

  async function loadComponent(
    path: string | undefined,
    moduleData?: PageDataPayload,
    options: { allowDocumentReload?: boolean } = {},
  ): Promise<unknown> {
    if (!path) return null;
    return await loadComponentFromUrl(
      path,
      pathToModuleUrl(path, studioEmbed, moduleData),
      options,
    );
  }

  return {
    loadComponent,
    loadComponentFromUrl,
    pathToModuleUrl,
    resolveHydrationModuleUrl,
    clearComponentCache,
    setStudioEmbed,
    setReleaseId,
    setReleaseAssetModules,
    setHMRRefreshTimestamp,
  };
}
