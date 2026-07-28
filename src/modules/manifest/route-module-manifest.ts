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
import { escapeHtml } from "#veryfront/utils/html-escape.ts";

const logger = serverLogger.component("route-module-manifest");

/** Bound on tracked routes; manifests are a regenerable preload optimization. */
const MAX_TRACKED_ROUTES = 2_000;
/** Bound on in-flight collections; abandoned ones (render errors) get evicted. */
const MAX_PENDING_COLLECTIONS = 2_000;
/** Bound one route's retained preload graph even when request IDs are attacker-controlled. */
const MAX_MODULES_PER_ROUTE = 10_000;
const MAX_MANIFEST_IDENTITY_LENGTH = 16 * 1024;
const MAX_PRELOAD_HINTS = 1_000;

export interface ModuleEntry {
  readonly path: string;
  readonly critical: boolean;
  readonly loadOrder: number;
  readonly sizeBytes?: number;
}

export interface RouteManifest {
  readonly route: string;
  readonly modules: readonly ModuleEntry[];
  readonly moduleCount: number;
  readonly totalSizeBytes?: number;
  readonly updatedAt: number;
  readonly renderCount: number;
}

const manifestStore = new LRUCache<string, RouteManifest>({ maxEntries: MAX_TRACKED_ROUTES });
const pendingCollections = new LRUCache<string, Set<string>>({
  maxEntries: MAX_PENDING_COLLECTIONS,
});

function assertBoundedIdentity(value: string, label: string): string {
  if (
    typeof value !== "string" ||
    value.length > MAX_MANIFEST_IDENTITY_LENGTH
  ) {
    throw new RangeError(
      `${label} must contain at most ${MAX_MANIFEST_IDENTITY_LENGTH} characters`,
    );
  }
  return value;
}

function buildProjectPrefix(projectSlug: string | undefined): string {
  if (projectSlug === undefined) return "project:undefined:";
  const slug = assertBoundedIdentity(projectSlug, "Project slug");
  return `project:value:${slug.length}:${slug}:`;
}

function buildKey(projectSlug: string | undefined, route: string): string {
  const normalizedRoute = assertBoundedIdentity(route, "Route");
  return `${buildProjectPrefix(projectSlug)}route:${normalizedRoute.length}:${normalizedRoute}`;
}

function buildManifest(
  route: string,
  modules: readonly ModuleEntry[],
  existingRenderCount: number | undefined,
): RouteManifest {
  const frozenModules = Object.freeze(
    modules.map((module) => Object.freeze({ ...module })),
  );
  return Object.freeze({
    route,
    modules: frozenModules,
    moduleCount: frozenModules.length,
    updatedAt: Date.now(),
    renderCount: (existingRenderCount ?? 0) + 1,
  });
}

export function startModuleCollection(requestId: string): void {
  pendingCollections.set(
    assertBoundedIdentity(requestId, "Request ID"),
    new Set(),
  );
}

export function recordModuleLoad(
  requestId: string,
  modulePath: string,
  _critical = false,
): void {
  const collection = pendingCollections.get(
    assertBoundedIdentity(requestId, "Request ID"),
  );
  if (!collection || collection.size >= MAX_MODULES_PER_ROUTE) return;
  collection.add(assertBoundedIdentity(modulePath, "Module path"));
}

export function finishModuleCollection(
  requestId: string,
  projectSlug: string | undefined,
  route: string,
  criticalModules: string[] = [],
): void {
  const normalizedRequestId = assertBoundedIdentity(requestId, "Request ID");
  const collection = pendingCollections.get(normalizedRequestId);
  if (!collection) return;

  const key = buildKey(projectSlug, route);
  const existing = manifestStore.get(key);

  const criticalSet = new Set<string>();
  for (const path of criticalModules) {
    const boundedPath = assertBoundedIdentity(path, "Critical module path");
    if (collection.has(boundedPath)) criticalSet.add(boundedPath);
  }

  // Retain the pending collection until every caller-controlled identity has
  // been validated, so a correct retry can still finish after invalid input.
  pendingCollections.delete(normalizedRequestId);

  const orderedPaths: string[] = [];
  const seenPaths = new Set<string>();
  const appendPath = (path: string): void => {
    if (seenPaths.has(path) || orderedPaths.length >= MAX_MODULES_PER_ROUTE) return;
    seenPaths.add(path);
    orderedPaths.push(path);
  };

  for (const path of criticalSet) appendPath(path);
  for (const path of collection) appendPath(path);
  for (const module of existing?.modules ?? []) appendPath(module.path);

  const existingByPath = new Map(
    (existing?.modules ?? []).map((module) => [module.path, module]),
  );
  const mergedModules = orderedPaths.map((path, loadOrder) => {
    const previous = existingByPath.get(path);
    return {
      path,
      critical: criticalSet.has(path) || previous?.critical === true,
      loadOrder,
      ...(previous?.sizeBytes === undefined ? {} : { sizeBytes: previous.sizeBytes }),
    };
  });

  const manifest = buildManifest(route, mergedModules, existing?.renderCount);
  manifestStore.set(key, manifest);

  logger.debug("Updated manifest", {
    key,
    moduleCount: manifest.moduleCount,
    renderCount: manifest.renderCount,
  });
}

function orderedModulePaths(
  manifest: RouteManifest,
  predicate: (module: ModuleEntry) => boolean,
): string[] {
  return manifest.modules
    .filter(predicate)
    .toSorted((left, right) => left.loadOrder - right.loadOrder)
    .map((module) => module.path);
}

function normalizeRecordedModulePath(path: string): string {
  const boundedPath = assertBoundedIdentity(path, "Module path");
  return boundedPath.replace(/^\/?_vf_modules\//, "");
}

function assertMaxHints(maxHints: number): number {
  if (
    !Number.isSafeInteger(maxHints) ||
    maxHints < 0 ||
    maxHints > MAX_PRELOAD_HINTS
  ) {
    throw new RangeError(
      `maxHints must be an integer between 0 and ${MAX_PRELOAD_HINTS}`,
    );
  }
  return maxHints;
}

export function getRouteManifest(
  projectSlug: string | undefined,
  route: string,
): RouteManifest | null {
  const key = buildKey(projectSlug, route);
  const manifest = manifestStore.get(key);
  metrics.recordRouteManifestLookup(!!manifest);

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

  return orderedModulePaths(manifest, () => true);
}

export function getCriticalModulePaths(
  projectSlug: string | undefined,
  route: string,
): string[] {
  const manifest = getRouteManifest(projectSlug, route);
  if (!manifest) return [];

  return orderedModulePaths(manifest, (module) => module.critical);
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
    const normalizedPath = normalizeRecordedModulePath(path);
    if (seenPaths.has(normalizedPath)) continue;
    if (newModules.length >= MAX_MODULES_PER_ROUTE) break;

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
    key,
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
  const boundedMaxHints = assertMaxHints(maxHints);
  const modules = getRouteModulePaths(projectSlug, route);
  if (modules.length === 0) return [];

  return modules.slice(0, boundedMaxHints).map((path) => {
    const url = escapeHtml(`/_vf_modules/${path}`);
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

  for (const [_key, manifest] of manifestStore.entries()) {
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
  const prefix = buildProjectPrefix(projectSlug);

  // Snapshot keys before deleting to avoid mutating during iteration.
  for (const key of [...manifestStore.keys()]) {
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
