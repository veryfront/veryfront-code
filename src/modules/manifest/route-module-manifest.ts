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

import { serverLogger } from "#veryfront/utils";

const logger = serverLogger.component("route-module-manifest");

interface ModuleEntry {
  path: string;
  critical: boolean;
  loadOrder: number;
  sizeBytes?: number;
}

interface RouteManifest {
  route: string;
  modules: ModuleEntry[];
  moduleCount: number;
  totalSizeBytes?: number;
  updatedAt: number;
  renderCount: number;
}

const manifestStore = new Map<string, RouteManifest>();
const pendingCollections = new Map<string, Set<string>>();

function buildKey(projectSlug: string | undefined, route: string): string {
  return `${projectSlug ?? "default"}:${route || "index"}`;
}

function buildManifest(
  route: string,
  modules: ModuleEntry[],
  existingRenderCount: number | undefined,
): RouteManifest {
  return {
    route,
    modules,
    moduleCount: modules.length,
    updatedAt: Date.now(),
    renderCount: (existingRenderCount ?? 0) + 1,
  };
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
    if (!collection.has(path)) continue;
    newModules.push({ path, critical: true, loadOrder: loadOrder++ });
  }

  for (const path of collection) {
    if (criticalSet.has(path)) continue;
    newModules.push({ path, critical: false, loadOrder: loadOrder++ });
  }

  const mergedModules = existing?.modules ?? [];
  const existingPaths = new Set(mergedModules.map((m) => m.path));

  for (const mod of newModules) {
    if (existingPaths.has(mod.path)) continue;
    mergedModules.push(mod);
    existingPaths.add(mod.path);
  }

  const manifest = buildManifest(route, mergedModules, existing?.renderCount);
  manifestStore.set(key, manifest);

  logger.debug("Updated manifest", {
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

  logger.debug("Get manifest", {
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

  const manifest = buildManifest(route, existingModules, existing?.renderCount);
  manifestStore.set(key, manifest);

  logger.debug("Recorded SSR modules", {
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

  logger.debug("Cleared manifests for project", { projectSlug });
}

export function clearAllManifests(): void {
  manifestStore.clear();
  pendingCollections.clear();
  logger.debug("Cleared all manifests");
}
