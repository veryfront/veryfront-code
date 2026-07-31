import { serverLogger } from "#veryfront/utils";
import { join } from "#veryfront/compat/path/index.ts";
import { isNotFoundError } from "#veryfront/platform/compat/fs.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { ApiRouteMatcher } from "#veryfront/routing/api/index.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import type { RouteDirectory } from "./types.ts";
import { utf8ByteLength } from "#veryfront/utils/utf8-byte-length.ts";

export const ROUTE_DISCOVERY_MAX_DEPTH = 64;
export const ROUTE_DISCOVERY_MAX_DIRECTORIES = 10_000;
export const ROUTE_DISCOVERY_MAX_ENTRIES = 100_000;
export const ROUTE_DISCOVERY_MAX_ROUTES = 10_000;
export const ROUTE_DISCOVERY_MAX_ENTRY_NAME_BYTES = 16 * 1024 * 1024;

interface RouteDiscoveryBudget {
  directories: number;
  entries: number;
  routes: number;
  entryNameBytes: number;
}

const logger = serverLogger.component("server");

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

function hasCanonicalPathSegment(path: string, expectedSegment: string): boolean {
  const canonicalSegments: string[] = [];
  for (const segment of path.split(/[\\/]+/)) {
    if (segment.length === 0 || segment === ".") continue;
    if (segment === "..") {
      canonicalSegments.pop();
      continue;
    }
    canonicalSegments.push(segment);
  }
  return canonicalSegments.includes(expectedSegment);
}

/** Check if a directory entry should be skipped during route discovery */
function shouldSkipEntry(name: string, parentPath?: string): boolean {
  if (name.startsWith("_")) return true;
  if (name === ".veryfront") return false;
  if (name.startsWith(".")) return true;

  const inVeryfront = parentPath !== undefined &&
    hasCanonicalPathSegment(parentPath, ".veryfront");
  return Boolean(inVeryfront && VERYFRONT_EXCLUDED_DIRS.has(name));
}

export class RouteDiscovery {
  private useRelativePaths: boolean;
  private discoveryGeneration = 0;

  constructor(
    private projectDir: string,
    private adapter: RuntimeAdapter,
    private router: ApiRouteMatcher,
    private config?: VeryfrontConfig,
  ) {
    const fsType = config?.fs?.type;
    this.useRelativePaths = fsType === "github" || fsType === "veryfront-api";
  }

  async discoverRoutes(): Promise<void> {
    const discoveryGeneration = ++this.discoveryGeneration;
    const candidateRouter = new ApiRouteMatcher();
    const budget: RouteDiscoveryBudget = {
      directories: 0,
      entries: 0,
      routes: 0,
      entryNameBytes: 0,
    };

    try {
      logger.debug("Starting route discovery", {
        useRelativePaths: this.useRelativePaths,
        fsType: this.config?.fs?.type,
      });

      const routeDirs = await this.resolveRouteDirectories();
      logger.debug("Route directories resolved", {
        count: routeDirs.length,
        dirs: routeDirs,
      });

      if (routeDirs.length === 0) {
        logger.warn("No route directories found; publishing an empty route generation");
      }

      for (const routeDir of routeDirs) {
        if (routeDir.type === "app") {
          logger.debug(`Discovering app routes in: ${routeDir.path}`);
          await this.discoverAppRoutes(routeDir.path, candidateRouter, budget);
          continue;
        }

        logger.debug(`Discovering pages routes in: ${routeDir.path}`);
        await this.discoverPagesRoutes(routeDir.path, "", candidateRouter, budget, 0);
      }

      const candidateRoutes = candidateRouter.listRoutes();

      // Filesystem scans can overlap (startup/manual refreshes do not all flow
      // through FileWatchSetup). An older snapshot that finishes last must not
      // replace the generation requested most recently.
      if (discoveryGeneration !== this.discoveryGeneration) {
        logger.debug("Discarding superseded route discovery generation", {
          discoveryGeneration,
          latestGeneration: this.discoveryGeneration,
        });
        return;
      }

      // Route discovery performs asynchronous filesystem I/O. Keep the live
      // matcher intact until the complete candidate has been validated, then
      // publish it synchronously so requests cannot observe a partial generation.
      this.router.clear();
      for (const route of candidateRoutes) {
        this.router.addRoute(route.pattern, route.page);
      }

      logger.debug("Route discovery complete", {
        routes: candidateRoutes.length,
      });
    } finally {
      candidateRouter.destroy();
    }
  }

  private async resolveRouteDirectories(): Promise<RouteDirectory[]> {
    const preferredRouter = this.config?.router;
    const appDir = this.config?.directories?.app ?? "app";
    const pagesDir = this.config?.directories?.pages ?? "pages";
    const results: RouteDirectory[] = [];

    const candidates: Array<{ type: "app" | "pages"; dir: string }> = [];
    if (preferredRouter === "app") candidates.push({ type: "app", dir: appDir });
    else if (preferredRouter === "pages") candidates.push({ type: "pages", dir: pagesDir });
    else candidates.push({ type: "app", dir: appDir }, { type: "pages", dir: pagesDir });

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
        const pagesFallback = this.useRelativePaths ? pagesDir : join(this.projectDir, pagesDir);
        if (await this.directoryExists(pagesFallback)) {
          logger.warn(
            `router="app" but ${appDir}/ directory missing; falling back to ${pagesDir}/`,
          );
          results.push({ type: "pages", path: pagesFallback });
        }
      } else if (preferredRouter === "pages") {
        const appFallback = this.useRelativePaths ? appDir : join(this.projectDir, appDir);
        if (await this.directoryExists(appFallback)) {
          logger.warn(
            `router="pages" but ${pagesDir}/ directory missing; using ${appDir}/`,
          );
          results.push({ type: "app", path: appFallback });
        }
      } else {
        const fallbackDirs: RouteDirectory[] = [
          { type: "app", path: this.useRelativePaths ? appDir : join(this.projectDir, appDir) },
          {
            type: "pages",
            path: this.useRelativePaths ? pagesDir : join(this.projectDir, pagesDir),
          },
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
      logger.debug("Checking directory exists", {
        path,
        useRelativePaths: this.useRelativePaths,
      });

      const stat = await this.adapter.fs.stat(path);

      logger.debug("Directory stat result", { path, isDirectory: stat.isDirectory });
      return stat.isDirectory;
    } catch (error) {
      if (isNotFoundError(error)) return false;
      logger.debug("Directory check failed", {
        errorName: error instanceof Error ? error.name : typeof error,
      });
      throw error;
    }
  }

  private async discoverPagesRoutes(
    dir: string,
    prefix: string,
    candidateRouter: ApiRouteMatcher,
    budget: RouteDiscoveryBudget,
    depth: number,
  ): Promise<void> {
    this.enterDirectory(budget, depth);
    logger.debug(`Reading directory: ${dir}`);

    for await (const entry of this.adapter.fs.readDir(dir)) {
      this.accountEntry(budget, entry.name);
      if (shouldSkipEntry(entry.name, dir)) continue;

      const fullPath = join(dir, entry.name);
      const routePath = `${prefix}/${entry.name.replace(/\.(tsx?|jsx?|mdx?)$/, "")}`.replace(
        /\/+/g,
        "/",
      );

      if (routePath.length > 500) {
        logger.warn(`Route path too long, skipping: ${routePath.slice(0, 100)}...`);
        continue;
      }

      if (entry.isDirectory) {
        await this.discoverPagesRoutes(fullPath, routePath, candidateRouter, budget, depth + 1);
        continue;
      }

      if (!entry.isFile || !/\.(tsx?|jsx?|mdx?)$/.test(entry.name)) continue;
      if (routePath.startsWith("/api")) continue;

      let pattern = routePath.replace(/\/index$/, "") || "/";
      pattern = pattern.replace(/\/+/g, "/");

      const relativePath = this.toProjectRelativePath(fullPath);
      this.accountRoute(budget);
      candidateRouter.addRoute(pattern, relativePath);
      logger.debug(`Discovered route: ${pattern} -> ${relativePath}`);
    }
  }

  private async discoverAppRoutes(
    dir: string,
    candidateRouter: ApiRouteMatcher,
    budget: RouteDiscoveryBudget,
  ): Promise<void> {
    await this.discoverAppRoutesRecursive(dir, [], candidateRouter, budget, 0);
  }

  private async discoverAppRoutesRecursive(
    dir: string,
    segments: string[],
    candidateRouter: ApiRouteMatcher,
    budget: RouteDiscoveryBudget,
    depth: number,
  ): Promise<void> {
    this.enterDirectory(budget, depth);
    logger.debug(`Reading app directory: ${dir}`);

    for await (const entry of this.adapter.fs.readDir(dir)) {
      this.accountEntry(budget, entry.name);
      if (shouldSkipEntry(entry.name, dir)) continue;

      const fullPath = join(dir, entry.name);

      if (entry.isDirectory) {
        const normalizedSegment = this.normalizeAppPathSegment(entry.name);
        const nextSegments = normalizedSegment ? [...segments, normalizedSegment] : segments;
        await this.discoverAppRoutesRecursive(
          fullPath,
          nextSegments,
          candidateRouter,
          budget,
          depth + 1,
        );
        continue;
      }

      if (!entry.isFile || !/^page\.(tsx?|ts|jsx?|js|mdx)$/.test(entry.name)) continue;

      const pattern = this.buildAppRoutePattern(segments);
      const relativePath = this.toProjectRelativePath(fullPath);
      this.accountRoute(budget);
      candidateRouter.addRoute(pattern, relativePath);
      logger.debug(`Discovered app route: ${pattern} -> ${relativePath}`);
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

  private enterDirectory(budget: RouteDiscoveryBudget, depth: number): void {
    if (depth > ROUTE_DISCOVERY_MAX_DEPTH) {
      throw new RangeError(
        `Route discovery directory depth limit of ${ROUTE_DISCOVERY_MAX_DEPTH} was exceeded`,
      );
    }
    if (budget.directories >= ROUTE_DISCOVERY_MAX_DIRECTORIES) {
      throw new RangeError(
        `Route discovery directory limit of ${ROUTE_DISCOVERY_MAX_DIRECTORIES} was exceeded`,
      );
    }
    budget.directories++;
  }

  private accountEntry(budget: RouteDiscoveryBudget, name: unknown): void {
    if (budget.entries >= ROUTE_DISCOVERY_MAX_ENTRIES) {
      throw new RangeError(
        `Route discovery entry limit of ${ROUTE_DISCOVERY_MAX_ENTRIES} was exceeded`,
      );
    }
    if (typeof name !== "string") {
      throw new TypeError("Route discovery received an invalid directory entry name");
    }
    if (
      name.length === 0 || name === "." || name === ".." ||
      name.includes("/") || name.includes("\\") || name.includes(":")
    ) {
      throw new TypeError("Route discovery entry name must be a canonical basename");
    }
    for (let index = 0; index < name.length; index++) {
      const code = name.charCodeAt(index);
      if (code <= 31 || code === 127) {
        throw new TypeError("Route discovery entry name must be a canonical basename");
      }
    }

    const remainingNameBytes = ROUTE_DISCOVERY_MAX_ENTRY_NAME_BYTES - budget.entryNameBytes;
    const nameBytes = utf8ByteLength(name, remainingNameBytes);
    if (nameBytes > remainingNameBytes) {
      throw new RangeError(
        `Route discovery entry-name byte budget of ${ROUTE_DISCOVERY_MAX_ENTRY_NAME_BYTES} was exceeded`,
      );
    }
    if (name !== name.normalize("NFC")) {
      throw new TypeError("Route discovery entry name must be a canonical basename");
    }

    budget.entries++;
    budget.entryNameBytes += nameBytes;
  }

  private accountRoute(budget: RouteDiscoveryBudget): void {
    if (budget.routes >= ROUTE_DISCOVERY_MAX_ROUTES) {
      throw new RangeError(
        `Route discovery route limit of ${ROUTE_DISCOVERY_MAX_ROUTES} was exceeded`,
      );
    }
    budget.routes++;
  }

  private toProjectRelativePath(fullPath: string): string {
    if (this.useRelativePaths) return fullPath;
    return fullPath.startsWith(this.projectDir)
      ? fullPath.slice(this.projectDir.length + 1)
      : fullPath;
  }
}
