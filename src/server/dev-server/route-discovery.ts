import { serverLogger as logger } from "@veryfront/utils";
import { join } from "@veryfront/platform/compat/path/index.ts";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import type { DynamicRouter } from "@veryfront/routing/api/index.ts";
import type { VeryfrontConfig } from "@veryfront/config";
import type { RouteDirectory } from "./types.ts";
import { withFallback } from "@veryfront/platform/adapters/index.ts";
import { createFileSystem } from "@veryfront/platform/compat/fs.ts";

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
function shouldSkipEntry(name: string, parentPath?: string): boolean {
  // Always skip underscore-prefixed entries
  if (name.startsWith("_")) return true;

  // Allow .veryfront directory itself
  if (name === ".veryfront") return false;

  // Skip other hidden directories/files
  if (name.startsWith(".")) return true;

  // If we're inside .veryfront, check against excluded subdirectories
  if (parentPath?.includes(".veryfront") || parentPath?.includes("/.veryfront")) {
    if (VERYFRONT_EXCLUDED_DIRS.has(name)) return true;
  }

  return false;
}

export class RouteDiscovery {
  private useRelativePaths: boolean;

  constructor(
    private projectDir: string,
    private adapter: RuntimeAdapter,
    private router: DynamicRouter,
    private config?: VeryfrontConfig,
  ) {
    // For remote FS adapters (github, veryfront-api), use relative paths
    const fsType = config?.fs?.type;
    this.useRelativePaths = fsType === "github" || fsType === "veryfront-api";
  }

  async discoverRoutes(): Promise<void> {
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
      } else {
        logger.debug(`[SERVER] Discovering pages routes in: ${routeDir.path}`);
        await this.discoverPagesRoutes(routeDir.path, "");
      }
    }

    logger.debug(`[SERVER] Route discovery complete`, {
      routes: this.router.listRoutes().length,
    });
  }

  private async resolveRouteDirectories(): Promise<RouteDirectory[]> {
    const preferredRouter = this.config?.router;
    const results: RouteDirectory[] = [];

    const candidates: Array<{ type: "app" | "pages"; dir: string }> = preferredRouter === "app"
      ? [{ type: "app", dir: "app" }]
      : preferredRouter === "pages"
      ? [{ type: "pages", dir: "pages" }]
      : [
        { type: "app", dir: "app" },
        { type: "pages", dir: "pages" },
      ];

    // Always check .veryfront directory for user-defined pages (agents, commands, etc.)
    const veryfrontDir = this.useRelativePaths ? ".veryfront" : join(this.projectDir, ".veryfront");
    if (await this.directoryExists(veryfrontDir)) {
      results.push({ type: "pages", path: veryfrontDir });
    }

    for (const candidate of candidates) {
      // For remote FS adapters, use relative paths; for local, use absolute
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
        {
          type: "app" as const,
          path: this.useRelativePaths ? "app" : join(this.projectDir, "app"),
        },
        {
          type: "pages" as const,
          path: this.useRelativePaths ? "pages" : join(this.projectDir, "pages"),
        },
      ];
      for (const fallback of fallbackDirs) {
        if (await this.directoryExists(fallback.path)) {
          results.push(fallback);
        }
      }
    }

    return results;
  }

  private async directoryExists(path: string): Promise<boolean> {
    try {
      logger.debug("[SERVER] Checking directory exists", {
        path,
        useRelativePaths: this.useRelativePaths,
      });
      // For remote FS adapters, don't fall back to local filesystem
      if (this.useRelativePaths) {
        const stat = await this.adapter.fs.stat(path);
        logger.debug("[SERVER] Directory stat result", { path, isDirectory: stat.isDirectory });
        return stat.isDirectory;
      }
      // For local filesystem, use fallback
      const stat = await withFallback(
        () => this.adapter.fs.stat(path),
        () => createFileSystem().stat(path),
        { operationName: "stat:routeDiscovery:directoryExists", logError: false },
      );
      return stat.isDirectory;
    } catch (error) {
      logger.debug("[SERVER] Directory check failed", { path, error: String(error) });
      return false;
    }
  }

  private async discoverPagesRoutes(dir: string, prefix: string): Promise<void> {
    try {
      logger.debug(`[SERVER] Reading directory: ${dir}`);
      for await (const entry of this.adapter.fs.readDir(dir)) {
        if (shouldSkipEntry(entry.name, dir)) continue;

        const fullPath = join(dir, entry.name);
        // Normalize route path: remove extension and collapse multiple slashes
        let routePath = `${prefix}/${entry.name.replace(/\.(tsx?|jsx?|mdx)$/, "")}`;
        routePath = routePath.replace(/\/+/g, "/"); // Collapse multiple slashes to single

        // Sanity check: if pattern is too long, something is wrong
        if (routePath.length > 500) {
          logger.warn(`[SERVER] Route path too long, skipping: ${routePath.slice(0, 100)}...`);
          continue;
        }

        if (entry.isDirectory) {
          await this.discoverPagesRoutes(fullPath, routePath);
        } else if (entry.isFile && /\.(tsx?|jsx?|mdx|ts)$/.test(entry.name)) {
          if (routePath.startsWith("/api")) continue;

          let pattern = routePath.replace(/\/index$/, "") || "/";
          pattern = pattern.replace(/\/+/g, "/"); // Collapse multiple slashes
          const relativePath = this.toProjectRelativePath(fullPath);

          this.router.addRoute(pattern, relativePath);
          logger.debug(`[SERVER] Discovered route: ${pattern} -> ${relativePath}`);
        }
      }
    } catch (error) {
      logger.error(`[SERVER] Failed to discover routes in ${dir}:`, error);
    }
  }

  private async discoverAppRoutes(dir: string): Promise<void> {
    await this.discoverAppRoutesRecursive(dir, []);
  }

  private async discoverAppRoutesRecursive(dir: string, segments: string[]): Promise<void> {
    try {
      logger.debug(`[SERVER] Reading app directory: ${dir}`);
      for await (const entry of this.adapter.fs.readDir(dir)) {
        if (shouldSkipEntry(entry.name, dir)) continue;

        const fullPath = join(dir, entry.name);

        if (entry.isDirectory) {
          const normalizedSegment = this.normalizeAppPathSegment(entry.name);
          const nextSegments = normalizedSegment ? [...segments, normalizedSegment] : segments;
          await this.discoverAppRoutesRecursive(fullPath, nextSegments);
          continue;
        }

        if (entry.isFile && /^page\.(tsx?|ts|jsx?|js|mdx)$/.test(entry.name)) {
          const pattern = this.buildAppRoutePattern(segments);
          const relativePath = this.toProjectRelativePath(fullPath);
          this.router.addRoute(pattern, relativePath);
          logger.debug(`[SERVER] Discovered app route: ${pattern} -> ${relativePath}`);
        }
      }
    } catch (error) {
      logger.error(`[SERVER] Failed to discover app routes in ${dir}:`, error);
    }
  }

  private normalizeAppPathSegment(dirName: string): string | null {
    if (!dirName) return null;
    if ((dirName.startsWith("(") && dirName.endsWith(")")) || dirName.startsWith("@")) {
      return null;
    }
    return dirName;
  }

  private buildAppRoutePattern(segments: string[]): string {
    if (segments.length === 0) return "/";
    const joined = segments.filter(Boolean).join("/");
    return `/${joined}`;
  }

  private toProjectRelativePath(fullPath: string): string {
    // For remote FS adapters, paths are already relative
    if (this.useRelativePaths) {
      return fullPath;
    }
    return fullPath.startsWith(this.projectDir)
      ? fullPath.slice(this.projectDir.length + 1)
      : fullPath;
  }
}
