/**
 * Route Module Manifest
 *
 * Tracks and caches module dependencies per route to enable:
 * - Expanded modulepreload hints (all dependencies, not just page/layout)
 * - Module batch endpoint (coalesce multiple requests)
 * - Background bundle generation
 * - 103 Early Hints with predictive preloading
 *
 * @module module-system/manifest/route-module-manifest
 */

import { serverLogger as logger } from "@veryfront/utils";

/**
 * Single module entry with metadata
 */
interface ModuleEntry {
  /** Module path (e.g., "pages/index.js") */
  path: string;
  /** Whether this is a critical path module (page/layout) */
  critical: boolean;
  /** Load order (lower = loaded earlier) */
  loadOrder: number;
  /** Size in bytes (if known) */
  sizeBytes?: number;
}

/**
 * Complete manifest for a single route
 */
interface RouteManifest {
  /** Route slug (e.g., "", "about", "blog/[slug]") */
  route: string;
  /** All modules needed for this route */
  modules: ModuleEntry[];
  /** Total count of modules */
  moduleCount: number;
  /** Total size in bytes (if all sizes known) */
  totalSizeBytes?: number;
  /** When this manifest was last updated */
  updatedAt: number;
  /** How many times this route has been rendered */
  renderCount: number;
}

/**
 * In-memory store for route manifests
 * Key: projectSlug:route
 */
const manifestStore = new Map<string, RouteManifest>();

/**
 * Pending module collection per request
 * Key: requestId
 */
const pendingCollections = new Map<string, Set<string>>();

/**
 * Build manifest key from project and route
 */
function buildKey(projectSlug: string | undefined, route: string): string {
  return `${projectSlug || "default"}:${route || "index"}`;
}

/**
 * Start collecting modules for a request
 */
export function startModuleCollection(requestId: string): void {
  pendingCollections.set(requestId, new Set());
}

/**
 * Record a module being loaded for a request
 */
export function recordModuleLoad(
  requestId: string,
  modulePath: string,
  _critical = false,
): void {
  const collection = pendingCollections.get(requestId);
  if (collection) {
    collection.add(modulePath);
  }
}

/**
 * Finish collecting and update the manifest
 */
export function finishModuleCollection(
  requestId: string,
  projectSlug: string | undefined,
  route: string,
  criticalModules: string[] = [],
): void {
  const collection = pendingCollections.get(requestId);
  if (!collection) {
    return;
  }

  pendingCollections.delete(requestId);

  const key = buildKey(projectSlug, route);
  const existing = manifestStore.get(key);

  // Build module entries
  const criticalSet = new Set(criticalModules);
  const modules: ModuleEntry[] = [];
  let loadOrder = 0;

  // Add critical modules first
  for (const path of criticalModules) {
    if (collection.has(path)) {
      modules.push({ path, critical: true, loadOrder: loadOrder++ });
    }
  }

  // Add remaining modules
  for (const path of collection) {
    if (!criticalSet.has(path)) {
      modules.push({ path, critical: false, loadOrder: loadOrder++ });
    }
  }

  // Merge with existing manifest (union of modules)
  const existingPaths = new Set(existing?.modules.map((m) => m.path) ?? []);
  const mergedModules = existing?.modules ?? [];

  for (const mod of modules) {
    if (!existingPaths.has(mod.path)) {
      mergedModules.push(mod);
    }
  }

  const manifest: RouteManifest = {
    route,
    modules: mergedModules,
    moduleCount: mergedModules.length,
    updatedAt: Date.now(),
    renderCount: (existing?.renderCount ?? 0) + 1,
  };

  manifestStore.set(key, manifest);

  logger.debug("[RouteModuleManifest] Updated manifest", {
    key,
    moduleCount: manifest.moduleCount,
    renderCount: manifest.renderCount,
  });
}

/**
 * Get manifest for a route (for modulepreload hints)
 */
export function getRouteManifest(
  projectSlug: string | undefined,
  route: string,
): RouteManifest | null {
  const key = buildKey(projectSlug, route);
  const manifest = manifestStore.get(key);
  logger.debug("[RouteModuleManifest] Get manifest", {
    key,
    found: !!manifest,
    moduleCount: manifest?.moduleCount ?? 0,
    renderCount: manifest?.renderCount ?? 0,
  });
  return manifest ?? null;
}

/**
 * Get all module paths for a route in load order
 */
export function getRouteModulePaths(
  projectSlug: string | undefined,
  route: string,
): string[] {
  const manifest = getRouteManifest(projectSlug, route);
  if (!manifest) {
    return [];
  }

  return manifest.modules
    .sort((a, b) => a.loadOrder - b.loadOrder)
    .map((m) => m.path);
}

/**
 * Get critical module paths for a route (page, layouts)
 */
export function getCriticalModulePaths(
  projectSlug: string | undefined,
  route: string,
): string[] {
  const manifest = getRouteManifest(projectSlug, route);
  if (!manifest) {
    return [];
  }

  return manifest.modules
    .filter((m) => m.critical)
    .sort((a, b) => a.loadOrder - b.loadOrder)
    .map((m) => m.path);
}

/**
 * Record modules loaded via SSR module loader
 * This is called from the MDX ESM loader when modules are fetched
 */
export function recordSSRModules(
  projectSlug: string | undefined,
  route: string,
  modules: string[],
): void {
  const key = buildKey(projectSlug, route);
  const existing = manifestStore.get(key);
  const existingModules = existing?.modules ?? [];
  const existingPaths = new Set(existingModules.map((m) => m.path));

  // Add new modules that don't already exist
  let addedCount = 0;
  for (const path of modules) {
    const normalizedPath = path.replace(/^_vf_modules\//, "");
    if (!existingPaths.has(normalizedPath)) {
      existingModules.push({
        path: normalizedPath,
        critical: false,
        loadOrder: existingModules.length,
      });
      existingPaths.add(normalizedPath);
      addedCount++;
    }
  }

  const manifest: RouteManifest = {
    route,
    modules: existingModules,
    moduleCount: existingModules.length,
    updatedAt: Date.now(),
    renderCount: (existing?.renderCount ?? 0) + 1,
  };

  manifestStore.set(key, manifest);

  logger.info("[RouteModuleManifest] Recorded SSR modules", {
    key,
    inputModules: modules.length,
    newModulesAdded: addedCount,
    totalModules: manifest.moduleCount,
    renderCount: manifest.renderCount,
  });
}

/**
 * Generate modulepreload hints HTML for a route
 * Returns empty array if no manifest exists (first render)
 */
export function generateModulePreloadHintsFromManifest(
  projectSlug: string | undefined,
  route: string,
  maxHints = 50,
): string[] {
  const modules = getRouteModulePaths(projectSlug, route);

  if (modules.length === 0) {
    return [];
  }

  // Limit to most critical modules to avoid overwhelming the browser
  const limitedModules = modules.slice(0, maxHints);

  return limitedModules.map((path) => {
    const url = `/_vf_modules/${path}`;
    return `<link rel="modulepreload" href="${url}">`;
  });
}

/**
 * Get manifest statistics for debugging
 */
export function getManifestStats(): {
  routeCount: number;
  totalModules: number;
  routes: Array<{ route: string; moduleCount: number; renderCount: number }>;
} {
  const routes: Array<{ route: string; moduleCount: number; renderCount: number }> = [];
  let totalModules = 0;

  for (const [key, manifest] of manifestStore) {
    routes.push({
      route: key,
      moduleCount: manifest.moduleCount,
      renderCount: manifest.renderCount,
    });
    totalModules += manifest.moduleCount;
  }

  return {
    routeCount: manifestStore.size,
    totalModules,
    routes,
  };
}

/**
 * Clear manifest for a specific project (on deployment)
 */
export function clearProjectManifests(projectSlug: string): void {
  const prefix = `${projectSlug}:`;
  for (const key of manifestStore.keys()) {
    if (key.startsWith(prefix)) {
      manifestStore.delete(key);
    }
  }
  logger.info("[RouteModuleManifest] Cleared manifests for project", { projectSlug });
}

/**
 * Clear all manifests (on server restart)
 */
export function clearAllManifests(): void {
  manifestStore.clear();
  pendingCollections.clear();
  logger.info("[RouteModuleManifest] Cleared all manifests");
}
