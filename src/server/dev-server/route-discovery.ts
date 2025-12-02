import { serverLogger as logger } from "@veryfront/utils";
import { join } from "std/path/mod.ts";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import type { DynamicRouter } from "@veryfront/routing/api/index.ts";
import type { VeryfrontConfig } from "@veryfront/config";
import type { RouteDirectory } from "./types.ts";
import { withFallback } from "@veryfront/platform/adapters/index.ts";
import { createFileSystem } from "../../platform/compat/fs.ts";

export class RouteDiscovery {
  constructor(
    private projectDir: string,
    private adapter: RuntimeAdapter,
    private router: DynamicRouter,
    private config?: VeryfrontConfig,
  ) {}

  async discoverRoutes(): Promise<void> {
    this.router.clear();
    this.router.clearCache();

    const routeDirs = await this.resolveRouteDirectories();
    if (routeDirs.length === 0) {
      logger.warn("[SERVER] No route directories found; skipping discovery");
      return;
    }

    for (const routeDir of routeDirs) {
      if (routeDir.type === "app") {
        logger.info(`[SERVER] Discovering app routes in: ${routeDir.path}`);
        await this.discoverAppRoutes(routeDir.path);
      } else {
        logger.info(`[SERVER] Discovering pages routes in: ${routeDir.path}`);
        await this.discoverPagesRoutes(routeDir.path, "");
      }
    }

    logger.info(`[SERVER] Route discovery complete`, {
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

    for (const candidate of candidates) {
      const absolute = join(this.projectDir, candidate.dir);
      if (await this.directoryExists(absolute)) {
        results.push({ type: candidate.type, path: absolute });
      }
    }

    if (results.length === 0 && preferredRouter === "app") {
      const pagesFallback = join(this.projectDir, "pages");
      if (await this.directoryExists(pagesFallback)) {
        logger.warn('[SERVER] router="app" but app/ directory missing; falling back to pages/');
        results.push({ type: "pages", path: pagesFallback });
      }
    }

    if (results.length === 0 && preferredRouter === "pages") {
      const appFallback = join(this.projectDir, "app");
      if (await this.directoryExists(appFallback)) {
        logger.warn('[SERVER] router="pages" but pages/ directory missing; using app/');
        results.push({ type: "app", path: appFallback });
      }
    }

    if (results.length === 0 && preferredRouter === undefined) {
      const fallbackDirs = [
        { type: "app" as const, path: join(this.projectDir, "app") },
        { type: "pages" as const, path: join(this.projectDir, "pages") },
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
      const stat = await withFallback(
        () => this.adapter.fs.stat(path),
        () => createFileSystem().stat(path),
        { operationName: "stat:routeDiscovery:directoryExists", logError: false },
      );
      return stat.isDirectory;
    } catch {
      return false;
    }
  }

  private async discoverPagesRoutes(dir: string, prefix: string): Promise<void> {
    try {
      logger.debug(`[SERVER] Reading directory: ${dir}`);
      for await (const entry of this.adapter.fs.readDir(dir)) {
        if (entry.name.startsWith("_") || entry.name.startsWith(".")) continue;

        const fullPath = join(dir, entry.name);
        const routePath = `${prefix}/${entry.name.replace(/\.(tsx?|jsx?|mdx)$/, "")}`;

        if (entry.isDirectory) {
          await this.discoverPagesRoutes(fullPath, routePath);
        } else if (entry.isFile && /\.(tsx?|jsx?|mdx|ts)$/.test(entry.name)) {
          if (routePath.startsWith("/api")) continue;

          const pattern = routePath.replace(/\/index$/, "") || "/";
          const relativePath = this.toProjectRelativePath(fullPath);

          this.router.addRoute(pattern, relativePath);
          logger.info(`[SERVER] Discovered route: ${pattern} -> ${relativePath}`);
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
        if (entry.name.startsWith(".") || entry.name.startsWith("_")) continue;

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
          logger.info(`[SERVER] Discovered app route: ${pattern} -> ${relativePath}`);
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
    return fullPath.startsWith(this.projectDir)
      ? fullPath.slice(this.projectDir.length + 1)
      : fullPath;
  }
}
