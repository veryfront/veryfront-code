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
import { LRUCache } from "#veryfront/utils/lru-wrapper.ts";
import { metrics } from "#veryfront/observability";
import { CACHE_INVARIANT_VIOLATION, SERVICE_OVERLOADED } from "#veryfront/errors";
import { hasUnsafeControlCharacters } from "#veryfront/errors/text-validation.ts";

const logger = serverLogger.component("route-module-manifest");

/** Bound on tracked routes; manifests are a regenerable preload optimization. */
const MAX_TRACKED_ROUTES = 2_000;
/** Bound on in-flight collections; abandoned ones (render errors) get evicted. */
const MAX_PENDING_COLLECTIONS = 2_000;
const PENDING_COLLECTION_TTL_MS = 5 * 60 * 1_000;
const MAX_MODULES_PER_ROUTE = 5_000;
const MAX_REQUEST_ID_LENGTH = 512;
const MAX_ROUTE_IDENTITY_LENGTH = 2_048;
const MAX_PROJECT_IDENTITY_LENGTH = 512;
const MAX_MODULE_PATH_LENGTH = 4_096;

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

const manifestStore = new LRUCache<string, RouteManifest>({ maxEntries: MAX_TRACKED_ROUTES });
const pendingCollections = new LRUCache<string, Map<string, boolean>>({
  maxEntries: MAX_PENDING_COLLECTIONS,
  ttlMs: PENDING_COLLECTION_TTL_MS,
});

function validateRequestId(requestId: string): void {
  if (
    requestId.length === 0 || requestId.length > MAX_REQUEST_ID_LENGTH ||
    hasUnsafeControlCharacters(requestId)
  ) {
    throw new RangeError("Invalid module collection request ID");
  }
}

function buildKey(projectSlug: string | undefined, route: string): string {
  const projectIdentity = projectSlug ?? null;
  const routeIdentity = route || "index";
  if (
    (projectIdentity !== null &&
      (projectIdentity.length === 0 || projectIdentity.length > MAX_PROJECT_IDENTITY_LENGTH ||
        hasUnsafeControlCharacters(projectIdentity))) ||
    routeIdentity.length > MAX_ROUTE_IDENTITY_LENGTH ||
    hasUnsafeControlCharacters(routeIdentity)
  ) {
    throw new RangeError("Invalid route manifest identity");
  }
  return JSON.stringify([projectIdentity, routeIdentity]);
}

function normalizeModulePath(path: string): string | null {
  const normalized = path.replace(/^\/?_vf_modules\//, "");
  if (
    normalized.length === 0 || normalized.length > MAX_MODULE_PATH_LENGTH ||
    normalized.startsWith("/") || normalized.includes("\\") ||
    hasUnsafeControlCharacters(normalized) ||
    /[\u2028\u2029"'<>?#]/.test(normalized) ||
    normalized.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    return null;
  }
  return normalized;
}

function cloneManifest(manifest: RouteManifest): RouteManifest {
  return {
    ...manifest,
    modules: manifest.modules.map((module) => ({ ...module })),
  };
}

function buildManifest(
  route: string,
  modules: ModuleEntry[],
  existingRenderCount: number | undefined,
): RouteManifest {
  return {
    route: route || "index",
    modules,
    moduleCount: modules.length,
    updatedAt: Date.now(),
    renderCount: (existingRenderCount ?? 0) + 1,
  };
}

export function startModuleCollection(requestId: string): void {
  validateRequestId(requestId);
  pendingCollections.cleanup();
  if (pendingCollections.has(requestId)) {
    throw CACHE_INVARIANT_VIOLATION.create({
      detail: "Module collection request is already active",
    });
  }
  if (pendingCollections.size >= MAX_PENDING_COLLECTIONS) {
    throw SERVICE_OVERLOADED.create({
      detail: "Module collection capacity exceeded",
    });
  }
  pendingCollections.set(requestId, new Map());
}

export function recordModuleLoad(
  requestId: string,
  modulePath: string,
  critical = false,
): void {
  validateRequestId(requestId);
  const normalized = normalizeModulePath(modulePath);
  if (!normalized) return;
  const collection = pendingCollections.get(requestId);
  if (!collection) return;
  if (!collection.has(normalized) && collection.size >= MAX_MODULES_PER_ROUTE) return;
  collection.set(normalized, critical || collection.get(normalized) === true);
}

export function finishModuleCollection(
  requestId: string,
  projectSlug: string | undefined,
  route: string,
  criticalModules: string[] = [],
): void {
  validateRequestId(requestId);
  const collection = pendingCollections.get(requestId);
  if (!collection) return;

  pendingCollections.delete(requestId);

  const key = buildKey(projectSlug, route);
  const existing = manifestStore.get(key);

  const criticalPaths = criticalModules
    .slice(0, MAX_MODULES_PER_ROUTE)
    .map(normalizeModulePath)
    .filter((path): path is string => path !== null);
  const criticalSet = new Set(criticalPaths);
  const orderedPaths: string[] = [];
  const seenPaths = new Set<string>();

  for (const path of criticalPaths) {
    if (!collection.has(path)) continue;
    orderedPaths.push(path);
    seenPaths.add(path);
  }

  for (const [path, critical] of collection) {
    if (critical) criticalSet.add(path);
    if (seenPaths.has(path)) continue;
    orderedPaths.push(path);
    seenPaths.add(path);
  }

  for (const module of existing?.modules ?? []) {
    if (seenPaths.has(module.path) || orderedPaths.length >= MAX_MODULES_PER_ROUTE) continue;
    orderedPaths.push(module.path);
    seenPaths.add(module.path);
  }

  const previousCritical = new Set(
    existing?.modules.filter((module) => module.critical).map((module) => module.path) ?? [],
  );
  const mergedModules = orderedPaths.slice(0, MAX_MODULES_PER_ROUTE).map((path, loadOrder) => ({
    path,
    critical: criticalSet.has(path) || previousCritical.has(path),
    loadOrder,
  }));

  const manifest = buildManifest(route, mergedModules, existing?.renderCount);
  manifestStore.set(key, manifest);

  logger.debug("Updated manifest", {
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
  metrics.recordRouteManifestLookup(!!manifest);

  logger.debug("Get manifest", { found: !!manifest, moduleCount: manifest?.moduleCount ?? 0 });

  return manifest ? cloneManifest(manifest) : null;
}

export function getRouteModulePaths(
  projectSlug: string | undefined,
  route: string,
): string[] {
  const manifest = getRouteManifest(projectSlug, route);
  if (!manifest) return [];

  return manifest.modules
    .slice()
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
  const seenPaths = new Set<string>();
  const newModules: ModuleEntry[] = [];

  for (const path of modules) {
    if (newModules.length >= MAX_MODULES_PER_ROUTE) break;
    const normalizedPath = normalizeModulePath(path);
    if (!normalizedPath) continue;
    if (seenPaths.has(normalizedPath)) continue;

    newModules.push({
      path: normalizedPath,
      critical: false,
      loadOrder: newModules.length,
    });
    seenPaths.add(normalizedPath);
  }

  const manifest = buildManifest(route, newModules, existing?.renderCount);
  manifestStore.set(key, manifest);

  logger.debug("Recorded SSR modules", {
    inputModules: modules.length,
    moduleCount: manifest.moduleCount,
    renderCount: manifest.renderCount,
  });
}

export function generateModulePreloadHintsFromManifest(
  projectSlug: string | undefined,
  route: string,
  maxHints = 50,
): string[] {
  if (!Number.isSafeInteger(maxHints) || maxHints < 0 || maxHints > MAX_MODULES_PER_ROUTE) {
    throw new RangeError("maxHints must be a non-negative safe integer within the route limit");
  }
  const modules = getRouteModulePaths(projectSlug, route);
  if (modules.length === 0) return [];

  return modules.slice(0, maxHints).map((path) => {
    const encodedPath = path.split("/").map(encodeURIComponent).join("/");
    const url = `/_vf_modules/${encodedPath}`;
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

  for (const [, manifest] of manifestStore.entries()) {
    routes.push({
      route: manifest.route,
      moduleCount: manifest.moduleCount,
      renderCount: manifest.renderCount,
    });
    totalModules += manifest.moduleCount;
  }

  return { routeCount: manifestStore.size, totalModules, routes };
}

export function clearProjectManifests(projectSlug: string): void {
  buildKey(projectSlug, "index");

  for (const key of [...manifestStore.keys()]) {
    let storedProject: unknown;
    try {
      [storedProject] = JSON.parse(key);
    } catch {
      continue;
    }
    if (storedProject !== projectSlug) continue;
    manifestStore.delete(key);
  }

  logger.debug("Cleared manifests for project");
}

export function clearAllManifests(): void {
  manifestStore.clear();
  pendingCollections.clear();
  logger.debug("Cleared all manifests");
}
