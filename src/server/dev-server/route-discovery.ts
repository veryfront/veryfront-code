import { serverLogger as logger } from "#veryfront/utils";
import { join } from "#veryfront/compat/path/index.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { DynamicRouter } from "#veryfront/routing/api/index.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import type { RouteDirectory } from "./types.ts";
import { withFallback } from "#veryfront/platform/adapters/fallback-wrapper.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";

const log = logger.component("server");

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
  if (name.startsWith("_")) return true;
  if (name === ".veryfront") return false;
  if (name.startsWith(".")) return true;

  const inVeryfront = parentPath?.includes(".veryfront") || parentPath?.includes("/.veryfront");
  return Boolean(inVeryfront && VERYFRONT_EXCLUDED_DIRS.has(name));
}

export class RouteDiscovery {
  private useRelativePaths: boolean;

  constructor(
    private projectDir: string,
    private adapter: RuntimeAdapter,
    private router: DynamicRouter,
    private config?: VeryfrontConfig,
  ) {
    const fsType = config?.fs?.type;
    this.useRelativePaths = fsType === "github" || fsType === "veryfront-api";
  }

  async discoverRoutes(): Promise<void> {
    this.router.clear();
    this.router.clearCache();

    log.debug("Starting route discovery", {
      useRelativePaths: this.useRelativePaths,
      fsType: this.config?.fs?.type,
    });

    const routeDirs = await this.resolveRouteDirectories();
    log.debug("Route directories resolved", {
      count: routeDirs.length,
      dirs: routeDirs,
    });

    if (routeDirs.length === 0) {
      log.warn("No route directories found; skipping discovery");
      return;
    }

    for (const routeDir of routeDirs) {
      if (routeDir.type === "app") {
        log.debug(`Discovering app routes in: ${routeDir.path}`);
        await this.discoverAppRoutes(routeDir.path);
        continue;
      }

      log.debug(`Discovering pages routes in: ${routeDir.path}`);
      await this.discoverPagesRoutes(routeDir.path, "");
    }

    log.debug("Route discovery complete", {
      routes: this.router.listRoutes().length,
    });
  }

  private async resolveRouteDirectories(): Promise<RouteDirectory[]> {
    const preferredRouter = this.config?.router;
    const results: RouteDirectory[] = [];

    const candidates: Array<{ type: "app" | "pages"; dir: string }> = [];
    if (preferredRouter === "app") candidates.push({ type: "app", dir: "app" });
    else if (preferredRouter === "pages") candidates.push({ type: "pages", dir: "pages" });
    else candidates.push({ type: "app", dir: "app" }, { type: "pages", dir: "pages" });

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

    if (results.length === 0) {
      if (preferredRouter === "app") {
        const pagesFallback = this.useRelativePaths ? "pages" : join(this.projectDir, "pages");
        if (await this.directoryExists(pagesFallback)) {
          log.warn('router="app" but app/ directory missing; falling back to pages/');
          results.push({ type: "pages", path: pagesFallback });
        }
      } else if (preferredRouter === "pages") {
        const appFallback = this.useRelativePaths ? "app" : join(this.projectDir, "app");
        if (await this.directoryExists(appFallback)) {
          log.warn('router="pages" but pages/ directory missing; using app/');
          results.push({ type: "app", path: appFallback });
        }
      } else {
        const fallbackDirs: RouteDirectory[] = [
          { type: "app", path: this.useRelativePaths ? "app" : join(this.projectDir, "app") },
          { type: "pages", path: this.useRelativePaths ? "pages" : join(this.projectDir, "pages") },
        ];

        for (const fallback of fallbackDirs) {
          if (await this.directoryExists(fallback.path)) results.push(fallback);
        }
      }
    }

    return results;
  }

  private async directoryExists(path: string): Promise<boolean> {
    try {
      log.debug("Checking directory exists", {
        path,
        useRelativePaths: this.useRelativePaths,
      });

      const stat = this.useRelativePaths ? await this.adapter.fs.stat(path) : await withFallback(
        () => this.adapter.fs.stat(path),
        () => createFileSystem().stat(path),
        { operationName: "stat:routeDiscovery:directoryExists", logError: false },
      );

      log.debug("Directory stat result", { path, isDirectory: stat.isDirectory });
      return stat.isDirectory;
    } catch (error) {
      log.debug("Directory check failed", { path, error: String(error) });
      return false;
    }
  }

  private async discoverPagesRoutes(dir: string, prefix: string): Promise<void> {
    try {
      log.debug(`Reading directory: ${dir}`);

      for await (const entry of this.adapter.fs.readDir(dir)) {
        if (shouldSkipEntry(entry.name, dir)) continue;

        const fullPath = join(dir, entry.name);
        const routePath = `${prefix}/${entry.name.replace(/\.(tsx?|jsx?|mdx)$/, "")}`.replace(
          /\/+/g,
          "/",
        );

        if (routePath.length > 500) {
          log.warn(`Route path too long, skipping: ${routePath.slice(0, 100)}...`);
          continue;
        }

        if (entry.isDirectory) {
          await this.discoverPagesRoutes(fullPath, routePath);
          continue;
        }

        if (!entry.isFile || !/\.(tsx?|jsx?|mdx|ts)$/.test(entry.name)) continue;
        if (routePath.startsWith("/api")) continue;

        let pattern = routePath.replace(/\/index$/, "") || "/";
        pattern = pattern.replace(/\/+/g, "/");

        const relativePath = this.toProjectRelativePath(fullPath);
        this.router.addRoute(pattern, relativePath);
        log.debug(`Discovered route: ${pattern} -> ${relativePath}`);
      }
    } catch (error) {
      log.error(`Failed to discover routes in ${dir}:`, error);
    }
  }

  private async discoverAppRoutes(dir: string): Promise<void> {
    await this.discoverAppRoutesRecursive(dir, []);
  }

  private async discoverAppRoutesRecursive(dir: string, segments: string[]): Promise<void> {
    try {
      log.debug(`Reading app directory: ${dir}`);

      for await (const entry of this.adapter.fs.readDir(dir)) {
        if (shouldSkipEntry(entry.name, dir)) continue;

        const fullPath = join(dir, entry.name);

        if (entry.isDirectory) {
          const normalizedSegment = this.normalizeAppPathSegment(entry.name);
          const nextSegments = normalizedSegment ? [...segments, normalizedSegment] : segments;
          await this.discoverAppRoutesRecursive(fullPath, nextSegments);
          continue;
        }

        if (!entry.isFile || !/^page\.(tsx?|ts|jsx?|js|mdx)$/.test(entry.name)) continue;

        const pattern = this.buildAppRoutePattern(segments);
        const relativePath = this.toProjectRelativePath(fullPath);
        this.router.addRoute(pattern, relativePath);
        log.debug(`Discovered app route: ${pattern} -> ${relativePath}`);
      }
    } catch (error) {
      log.error(`Failed to discover app routes in ${dir}:`, error);
    }
  }

  private normalizeAppPathSegment(dirName: string): string | null {
    if (!dirName) return null;
    if ((dirName.startsWith("(") && dirName.endsWith(")")) || dirName.startsWith("@")) return null;
    return dirName;
  }

  private buildAppRoutePattern(segments: string[]): string {
    if (segments.length === 0) return "/";
    return `/${segments.filter(Boolean).join("/")}`;
  }

  private toProjectRelativePath(fullPath: string): string {
    if (this.useRelativePaths) return fullPath;
    return fullPath.startsWith(this.projectDir)
      ? fullPath.slice(this.projectDir.length + 1)
      : fullPath;
  }
}
