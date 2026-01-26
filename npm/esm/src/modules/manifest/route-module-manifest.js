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
 * In-memory store for route manifests
 * Key: projectSlug:route
 */
const manifestStore = new Map();
/**
 * Pending module collection per request
 * Key: requestId
 */
const pendingCollections = new Map();
function buildKey(projectSlug, route) {
    return `${projectSlug ?? "default"}:${route || "index"}`;
}
export function startModuleCollection(requestId) {
    pendingCollections.set(requestId, new Set());
}
export function recordModuleLoad(requestId, modulePath, _critical = false) {
    pendingCollections.get(requestId)?.add(modulePath);
}
export function finishModuleCollection(requestId, projectSlug, route, criticalModules = []) {
    const collection = pendingCollections.get(requestId);
    if (!collection)
        return;
    pendingCollections.delete(requestId);
    const key = buildKey(projectSlug, route);
    const existing = manifestStore.get(key);
    const criticalSet = new Set(criticalModules);
    const newModules = [];
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
        if (existingPaths.has(mod.path))
            continue;
        mergedModules.push(mod);
        existingPaths.add(mod.path);
    }
    const manifest = {
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
export function getRouteManifest(projectSlug, route) {
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
export function getRouteModulePaths(projectSlug, route) {
    const manifest = getRouteManifest(projectSlug, route);
    if (!manifest)
        return [];
    return manifest.modules
        .sort((a, b) => a.loadOrder - b.loadOrder)
        .map((m) => m.path);
}
export function getCriticalModulePaths(projectSlug, route) {
    const manifest = getRouteManifest(projectSlug, route);
    if (!manifest)
        return [];
    return manifest.modules
        .filter((m) => m.critical)
        .sort((a, b) => a.loadOrder - b.loadOrder)
        .map((m) => m.path);
}
export function recordSSRModules(projectSlug, route, modules) {
    const key = buildKey(projectSlug, route);
    const existing = manifestStore.get(key);
    const existingModules = existing?.modules ?? [];
    const existingPaths = new Set(existingModules.map((m) => m.path));
    let addedCount = 0;
    for (const path of modules) {
        const normalizedPath = path.replace(/^_vf_modules\//, "");
        if (existingPaths.has(normalizedPath))
            continue;
        existingModules.push({
            path: normalizedPath,
            critical: false,
            loadOrder: existingModules.length,
        });
        existingPaths.add(normalizedPath);
        addedCount++;
    }
    const manifest = {
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
export function generateModulePreloadHintsFromManifest(projectSlug, route, maxHints = 50) {
    const modules = getRouteModulePaths(projectSlug, route);
    if (modules.length === 0)
        return [];
    return modules.slice(0, maxHints).map((path) => {
        const url = `/_vf_modules/${path}`;
        return `<link rel="modulepreload" href="${url}">`;
    });
}
export function getManifestStats() {
    const routes = [];
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
export function clearProjectManifests(projectSlug) {
    const prefix = `${projectSlug}:`;
    for (const key of manifestStore.keys()) {
        if (!key.startsWith(prefix))
            continue;
        manifestStore.delete(key);
    }
    logger.debug("[RouteModuleManifest] Cleared manifests for project", { projectSlug });
}
export function clearAllManifests() {
    manifestStore.clear();
    pendingCollections.clear();
    logger.debug("[RouteModuleManifest] Cleared all manifests");
}
