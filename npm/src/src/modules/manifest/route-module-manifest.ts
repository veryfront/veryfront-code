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

import { serverLogger as logger } from "../../utils/index.js";

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

function buildKey(projectSlug: string | undefined, route: string): string {
  return `${projectSlug ?? "default"}:${route || "index"}`;
}

export function startModuleCollection(requestId: string): void {
  pendingCollections.set(requestId, new Set());
}

export function recordModuleLoad(
  requestId: string,
  modulePath: string,
  _critical = false,
): void {
  pendingCollections.get(requestId)?.add(modulePath);
}

export function finishModuleCollection(
  requestId: string,
  projectSlug: string | undefined,
  route: string,
  criticalModules: string[] = [],
): void {
  const collection = pendingCollections.get(requestId);
  if (!collection) return;

  pendingCollections.delete(requestId);

  const key = buildKey(projectSlug, route);
  const existing = manifestStore.get(key);

  const criticalSet = new Set(criticalModules);
  const newModules: ModuleEntry[] = [];
  let loadOrder = 0;

  for (const path of criticalModules) {
    if (collection.has(path)) {
      newModules.push({ path, critical: true, loadOrder: loadOrder++ });
    }
  }

  for (const path of collection) {
    if (!criticalSet.has(path)) {
      newModules.push({ path, critical: false, loadOrder: loadOrder++ });
    }
  }

  const mergedModules = existing?.modules ?? [];
  const existingPaths = new Set(mergedModules.map((m) => m.path));

  for (const mod of newModules) {
    if (existingPaths.has(mod.path)) continue;
    mergedModules.push(mod);
    existingPaths.add(mod.path);
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

export function getRouteModulePaths(
  projectSlug: string | undefined,
  route: string,
): string[] {
  const manifest = getRouteManifest(projectSlug, route);
  if (!manifest) return [];

  return manifest.modules
    .sort((a, b) => a.loadOrder - b.loadOrder)
    .map((m) => m.path);
}

export function getCriticalModulePaths(
  projectSlug: string | undefined,
  route: string,
): string[] {
  const manifest = getRouteManifest(projectSlug, route);
  if (!manifest) return [];

  return manifest.modules
    .filter((m) => m.critical)
    .sort((a, b) => a.loadOrder - b.loadOrder)
    .map((m) => m.path);
}

export function recordSSRModules(
  projectSlug: string | undefined,
  route: string,
  modules: string[],
): void {
  const key = buildKey(projectSlug, route);
  const existing = manifestStore.get(key);
  const existingModules = existing?.modules ?? [];
  const existingPaths = new Set(existingModules.map((m) => m.path));

  let addedCount = 0;

  for (const path of modules) {
    const normalizedPath = path.replace(/^_vf_modules\//, "");
    if (existingPaths.has(normalizedPath)) continue;

    existingModules.push({
      path: normalizedPath,
      critical: false,
      loadOrder: existingModules.length,
    });
    existingPaths.add(normalizedPath);
    addedCount++;
  }

  const manifest: RouteManifest = {
    route,
    modules: existingModules,
    moduleCount: existingModules.length,
    updatedAt: Date.now(),
    renderCount: (existing?.renderCount ?? 0) + 1,
  };

  manifestStore.set(key, manifest);

  logger.debug("[RouteModuleManifest] Recorded SSR modules", {
    key,
    inputModules: modules.length,
    newModulesAdded: addedCount,
    totalModules: manifest.moduleCount,
    renderCount: manifest.renderCount,
  });
}

export function generateModulePreloadHintsFromManifest(
  projectSlug: string | undefined,
  route: string,
  maxHints = 50,
): string[] {
  const modules = getRouteModulePaths(projectSlug, route);
  if (modules.length === 0) return [];

  return modules.slice(0, maxHints).map((path) => {
    const url = `/_vf_modules/${path}`;
    return `<link rel="modulepreload" href="${url}">`;
  });
}

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

  return { routeCount: manifestStore.size, totalModules, routes };
}

export function clearProjectManifests(projectSlug: string): void {
  const prefix = `${projectSlug}:`;

  for (const key of manifestStore.keys()) {
    if (!key.startsWith(prefix)) continue;
    manifestStore.delete(key);
  }

  logger.debug("[RouteModuleManifest] Cleared manifests for project", { projectSlug });
}

export function clearAllManifests(): void {
  manifestStore.clear();
  pendingCollections.clear();
  logger.debug("[RouteModuleManifest] Cleared all manifests");
}
