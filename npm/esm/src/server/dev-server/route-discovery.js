import { serverLogger as logger } from "../../utils/index.js";
import { join } from "../../platform/compat/path/index.js";
import { withFallback } from "../../platform/adapters/fallback-wrapper.js";
import { createFileSystem } from "../../platform/compat/fs.js";
/** Directories within .veryfront that should be excluded from routing */
const VERYFRONT_EXCLUDED_DIRS = new Set([
    "cache",
    "compiled",
    "tmp",
    "temp",
    "output",
    "optimized-images",
    "css",
]);
/** Check if a directory entry should be skipped during route discovery */
function shouldSkipEntry(name, parentPath) {
    if (name.startsWith("_"))
        return true;
    if (name === ".veryfront")
        return false;
    if (name.startsWith("."))
        return true;
    const inVeryfront = parentPath?.includes(".veryfront") || parentPath?.includes("/.veryfront");
    return Boolean(inVeryfront && VERYFRONT_EXCLUDED_DIRS.has(name));
}
export class RouteDiscovery {
    projectDir;
    adapter;
    router;
    config;
    useRelativePaths;
    constructor(projectDir, adapter, router, config) {
        this.projectDir = projectDir;
        this.adapter = adapter;
        this.router = router;
        this.config = config;
        const fsType = config?.fs?.type;
        this.useRelativePaths = fsType === "github" || fsType === "veryfront-api";
    }
    async discoverRoutes() {
        this.router.clear();
        this.router.clearCache();
        logger.debug("[SERVER] Starting route discovery", {
            useRelativePaths: this.useRelativePaths,
            fsType: this.config?.fs?.type,
        });
        const routeDirs = await this.resolveRouteDirectories();
        logger.debug("[SERVER] Route directories resolved", {
            count: routeDirs.length,
            dirs: routeDirs,
        });
        if (routeDirs.length === 0) {
            logger.warn("[SERVER] No route directories found; skipping discovery");
            return;
        }
        for (const routeDir of routeDirs) {
            if (routeDir.type === "app") {
                logger.debug(`[SERVER] Discovering app routes in: ${routeDir.path}`);
                await this.discoverAppRoutes(routeDir.path);
                continue;
            }
            logger.debug(`[SERVER] Discovering pages routes in: ${routeDir.path}`);
            await this.discoverPagesRoutes(routeDir.path, "");
        }
        logger.debug("[SERVER] Route discovery complete", {
            routes: this.router.listRoutes().length,
        });
    }
    async resolveRouteDirectories() {
        const preferredRouter = this.config?.router;
        const results = [];
        const candidates = [];
        if (preferredRouter === "app")
            candidates.push({ type: "app", dir: "app" });
        else if (preferredRouter === "pages")
            candidates.push({ type: "pages", dir: "pages" });
        else
            candidates.push({ type: "app", dir: "app" }, { type: "pages", dir: "pages" });
        const veryfrontDir = this.useRelativePaths ? ".veryfront" : join(this.projectDir, ".veryfront");
        if (await this.directoryExists(veryfrontDir)) {
            results.push({ type: "pages", path: veryfrontDir });
        }
        for (const candidate of candidates) {
            const pathToCheck = this.useRelativePaths
                ? candidate.dir
                : join(this.projectDir, candidate.dir);
            if (await this.directoryExists(pathToCheck)) {
                results.push({ type: candidate.type, path: pathToCheck });
            }
        }
        if (results.length === 0 && preferredRouter === "app") {
            const pagesFallback = this.useRelativePaths ? "pages" : join(this.projectDir, "pages");
            if (await this.directoryExists(pagesFallback)) {
                logger.warn('[SERVER] router="app" but app/ directory missing; falling back to pages/');
                results.push({ type: "pages", path: pagesFallback });
            }
        }
        if (results.length === 0 && preferredRouter === "pages") {
            const appFallback = this.useRelativePaths ? "app" : join(this.projectDir, "app");
            if (await this.directoryExists(appFallback)) {
                logger.warn('[SERVER] router="pages" but pages/ directory missing; using app/');
                results.push({ type: "app", path: appFallback });
            }
        }
        if (results.length === 0 && preferredRouter === undefined) {
            const fallbackDirs = [
                { type: "app", path: this.useRelativePaths ? "app" : join(this.projectDir, "app") },
                { type: "pages", path: this.useRelativePaths ? "pages" : join(this.projectDir, "pages") },
            ];
            for (const fallback of fallbackDirs) {
                if (await this.directoryExists(fallback.path))
                    results.push(fallback);
            }
        }
        return results;
    }
    async directoryExists(path) {
        try {
            logger.debug("[SERVER] Checking directory exists", {
                path,
                useRelativePaths: this.useRelativePaths,
            });
            if (this.useRelativePaths) {
                const stat = await this.adapter.fs.stat(path);
                logger.debug("[SERVER] Directory stat result", { path, isDirectory: stat.isDirectory });
                return stat.isDirectory;
            }
            const stat = await withFallback(() => this.adapter.fs.stat(path), () => createFileSystem().stat(path), { operationName: "stat:routeDiscovery:directoryExists", logError: false });
            return stat.isDirectory;
        }
        catch (error) {
            logger.debug("[SERVER] Directory check failed", { path, error: String(error) });
            return false;
        }
    }
    async discoverPagesRoutes(dir, prefix) {
        try {
            logger.debug(`[SERVER] Reading directory: ${dir}`);
            for await (const entry of this.adapter.fs.readDir(dir)) {
                if (shouldSkipEntry(entry.name, dir))
                    continue;
                const fullPath = join(dir, entry.name);
                const routePath = `${prefix}/${entry.name.replace(/\.(tsx?|jsx?|mdx)$/, "")}`.replace(/\/+/g, "/");
                if (routePath.length > 500) {
                    logger.warn(`[SERVER] Route path too long, skipping: ${routePath.slice(0, 100)}...`);
                    continue;
                }
                if (entry.isDirectory) {
                    await this.discoverPagesRoutes(fullPath, routePath);
                    continue;
                }
                if (!entry.isFile || !/\.(tsx?|jsx?|mdx|ts)$/.test(entry.name))
                    continue;
                if (routePath.startsWith("/api"))
                    continue;
                let pattern = routePath.replace(/\/index$/, "") || "/";
                pattern = pattern.replace(/\/+/g, "/");
                const relativePath = this.toProjectRelativePath(fullPath);
                this.router.addRoute(pattern, relativePath);
                logger.debug(`[SERVER] Discovered route: ${pattern} -> ${relativePath}`);
            }
        }
        catch (error) {
            logger.error(`[SERVER] Failed to discover routes in ${dir}:`, error);
        }
    }
    async discoverAppRoutes(dir) {
        await this.discoverAppRoutesRecursive(dir, []);
    }
    async discoverAppRoutesRecursive(dir, segments) {
        try {
            logger.debug(`[SERVER] Reading app directory: ${dir}`);
            for await (const entry of this.adapter.fs.readDir(dir)) {
                if (shouldSkipEntry(entry.name, dir))
                    continue;
                const fullPath = join(dir, entry.name);
                if (entry.isDirectory) {
                    const normalizedSegment = this.normalizeAppPathSegment(entry.name);
                    const nextSegments = normalizedSegment ? [...segments, normalizedSegment] : segments;
                    await this.discoverAppRoutesRecursive(fullPath, nextSegments);
                    continue;
                }
                if (!entry.isFile || !/^page\.(tsx?|ts|jsx?|js|mdx)$/.test(entry.name))
                    continue;
                const pattern = this.buildAppRoutePattern(segments);
                const relativePath = this.toProjectRelativePath(fullPath);
                this.router.addRoute(pattern, relativePath);
                logger.debug(`[SERVER] Discovered app route: ${pattern} -> ${relativePath}`);
            }
        }
        catch (error) {
            logger.error(`[SERVER] Failed to discover app routes in ${dir}:`, error);
        }
    }
    normalizeAppPathSegment(dirName) {
        if (!dirName)
            return null;
        if ((dirName.startsWith("(") && dirName.endsWith(")")) || dirName.startsWith("@"))
            return null;
        return dirName;
    }
    buildAppRoutePattern(segments) {
        if (segments.length === 0)
            return "/";
        return `/${segments.filter(Boolean).join("/")}`;
    }
    toProjectRelativePath(fullPath) {
        if (this.useRelativePaths)
            return fullPath;
        return fullPath.startsWith(this.projectDir)
            ? fullPath.slice(this.projectDir.length + 1)
            : fullPath;
    }
}
