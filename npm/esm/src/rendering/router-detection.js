/**************************
 * Router Detection
 *
 * Determines whether to use App Router or Pages Router based on:
 * - Explicit configuration (config.router)
 * - Directory structure analysis
 * - Route file presence detection
 **************************/
import { join } from "../platform/compat/path-helper.js";
import { createFileSystem } from "../platform/compat/fs.js";
import { LRUCache } from "../utils/lru-wrapper.js";
import { withSpan } from "../observability/tracing/otlp-setup.js";
import { SpanNames } from "../observability/tracing/span-names.js";
// Re-export from app-route-resolver for backward compatibility
export { getAppRouteEntity } from "./app-route-resolver.js";
const routerDetectionCache = new LRUCache({
    maxEntries: 200,
    ttlMs: 60_000,
});
/**
 * Clear the router detection cache. Call when filesystem changes.
 * @deprecated Use clearRouterDetectionCacheForProject for multi-tenant deployments
 */
export function clearRouterDetectionCache() {
    routerDetectionCache.clear();
}
/**
 * Clear the router detection cache for a specific project.
 * Use this in multi-tenant deployments to avoid clearing other projects' caches.
 */
export function clearRouterDetectionCacheForProject(projectDir) {
    routerDetectionCache.delete(projectDir);
}
/**
 * Detect if app router should be used based on config and directory structure
 */
export async function detectAppRouter(projectDir, config, adapter) {
    if (config?.router === "app")
        return true;
    if (config?.router === "pages")
        return false;
    const cached = routerDetectionCache.get(projectDir);
    if (cached !== undefined)
        return cached;
    return await withSpan(SpanNames.ROUTER_DETECT_APP, async () => {
        const result = await detectAppRouterImpl(projectDir, config, adapter);
        routerDetectionCache.set(projectDir, result);
        return result;
    }, {
        "router.project_dir": projectDir,
        "router.config_router": config?.router ?? "auto",
    });
}
async function detectAppRouterImpl(projectDir, config, adapter) {
    const appDirName = config?.directories?.app ?? "app";
    const pagesDirName = config?.directories?.pages ?? "pages";
    const appDir = join(projectDir, appDirName);
    const pagesDir = join(projectDir, pagesDirName);
    const appStat = await statWithFallback(appDir, adapter);
    const pagesStat = await statWithFallback(pagesDir, adapter);
    const hasAppDir = Boolean(appStat?.isDirectory);
    const hasPagesDir = Boolean(pagesStat?.isDirectory);
    if (hasAppDir && (await hasRouteFiles(appDir, adapter)))
        return true;
    if (hasPagesDir && (await hasRouteFiles(pagesDir, adapter)))
        return false;
    if (hasPagesDir && !hasAppDir)
        return false;
    return true;
}
const ROUTE_EXTENSIONS = new Set([".mdx", ".md", ".tsx", ".jsx", ".ts", ".js"]);
const ROUTE_PATTERNS = ["page", "layout", "error", "loading", "not-found", "index"];
async function hasRouteFiles(dir, adapter) {
    const entries = await readDirWithFallback(dir, adapter);
    for (const entry of entries) {
        if (entry.isFile) {
            const name = entry.name.toLowerCase();
            const dotIndex = name.lastIndexOf(".");
            const ext = dotIndex === -1 ? "" : name.slice(dotIndex);
            if (ROUTE_EXTENSIONS.has(ext) &&
                ROUTE_PATTERNS.some((pattern) => name.startsWith(pattern))) {
                return true;
            }
            continue;
        }
        if (entry.isDirectory && (await hasRouteFiles(join(dir, entry.name), adapter))) {
            return true;
        }
    }
    return false;
}
async function withAdapterFallback(adapterFn, fallbackFn, defaultValue) {
    try {
        return await adapterFn();
    }
    catch {
        try {
            return await fallbackFn();
        }
        catch {
            return defaultValue;
        }
    }
}
async function statWithFallback(path, adapter) {
    const fs = createFileSystem();
    return await withAdapterFallback(async () => (await adapter.fs.stat(path)), async () => {
        const stat = await fs.stat(path);
        return {
            size: stat.size,
            isFile: stat.isFile,
            isDirectory: stat.isDirectory,
            isSymlink: stat.isSymlink,
            mtime: stat.mtime,
        };
    }, null);
}
async function collectDirEntries(iterable) {
    const entries = [];
    for await (const entry of iterable) {
        entries.push({
            name: entry.name,
            isFile: entry.isFile,
            isDirectory: entry.isDirectory,
            isSymlink: entry.isSymlink ?? false,
        });
    }
    return entries;
}
async function readDirWithFallback(dir, adapter) {
    const fs = createFileSystem();
    return await withAdapterFallback(() => collectDirEntries(adapter.fs.readDir(dir)), () => collectDirEntries(fs.readDir(dir)), []);
}
