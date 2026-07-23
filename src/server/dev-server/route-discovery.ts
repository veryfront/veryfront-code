import { serverLogger } from "#veryfront/utils";
import { isAbsolute, join, relative, sep } from "#veryfront/compat/path/index.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { ApiRouteMatcher } from "#veryfront/routing/api/index.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import type { RouteDirectory } from "./types.ts";
import { isNotFoundError } from "#veryfront/platform/compat/fs.ts";
import { hasUnsafeControlCharacters } from "#veryfront/errors/text-validation.ts";

const logger = serverLogger.component("server");
const MAX_ROUTE_DIRECTORY_LENGTH = 512;
const MAX_DIRECTORY_ENTRY_LENGTH = 255;
const MAX_DISCOVERY_DEPTH = 64;
const MAX_DISCOVERY_ENTRIES = 100_000;
const MAX_ROUTE_PATH_LENGTH = 500;

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

  const inVeryfront = parentPath?.replaceAll("\\", "/").split("/").includes(".veryfront");
  return Boolean(inVeryfront && VERYFRONT_EXCLUDED_DIRS.has(name));
}

function normalizeRouteDirectory(value: string): string {
  if (
    typeof value !== "string" || value.length === 0 || value.length > MAX_ROUTE_DIRECTORY_LENGTH
  ) {
    throw new TypeError("Route directory must be a bounded project-relative path");
  }

  let normalized = value.replaceAll("\\", "/");
  while (normalized.startsWith("./")) normalized = normalized.slice(2);
  normalized = normalized.replace(/\/+$/, "");
  const segments = normalized.split("/");
  if (
    normalized.length === 0 || normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized) ||
    segments.some((segment) =>
      segment.length === 0 || segment === "." || segment === ".." ||
      hasUnsafeControlCharacters(segment)
    )
  ) {
    throw new TypeError("Route directory must be a bounded project-relative path");
  }

  return segments.join("/");
}

function assertSafeDirectoryEntryName(name: unknown): asserts name is string {
  if (
    typeof name !== "string" || name.length === 0 || name.length > MAX_DIRECTORY_ENTRY_LENGTH ||
    name === "." || name === ".." || name.includes("/") || name.includes("\\") ||
    hasUnsafeControlCharacters(name)
  ) {
    throw new TypeError("Route directory entry is invalid");
  }
}

interface DiscoveryState {
  entriesVisited: number;
}

function isMissingDirectoryError(error: unknown): boolean {
  try {
    return isNotFoundError(error);
  } catch {
    return false;
  }
}

export class RouteDiscovery {
  private useRelativePaths: boolean;
  private discoveryTask?: Promise<void>;

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
    if (this.discoveryTask) return await this.discoveryTask;

    const task = this.discoverRouteGeneration();
    this.discoveryTask = task;
    try {
      await task;
    } finally {
      if (this.discoveryTask === task) this.discoveryTask = undefined;
    }
  }

  private async discoverRouteGeneration(): Promise<void> {
    const discoveredRouter = new ApiRouteMatcher();
    const state: DiscoveryState = { entriesVisited: 0 };
    try {
      await this.populateRouteGeneration(discoveredRouter, state);
    } finally {
      discoveredRouter.destroy();
    }
  }

  private async populateRouteGeneration(
    discoveredRouter: ApiRouteMatcher,
    state: DiscoveryState,
  ): Promise<void> {
    logger.debug("Starting route discovery", {
      useRelativePaths: this.useRelativePaths,
    });

    const routeDirs = await this.resolveRouteDirectories();
    logger.debug("Route directories resolved", {
      count: routeDirs.length,
      appDirectoryCount: routeDirs.filter((route) => route.type === "app").length,
      pagesDirectoryCount: routeDirs.filter((route) => route.type === "pages").length,
    });

    if (routeDirs.length === 0) {
      this.commitRoutes(discoveredRouter);
      logger.warn("No route directories found; skipping discovery");
      return;
    }

    for (const routeDir of routeDirs) {
      if (routeDir.type === "app") {
        logger.debug("Discovering app routes");
        await this.discoverAppRoutes(discoveredRouter, routeDir.path, state);
        continue;
      }

      logger.debug("Discovering pages routes");
      await this.discoverPagesRoutes(discoveredRouter, routeDir.path, "", state, 0);
    }

    this.commitRoutes(discoveredRouter);
    logger.debug("Route discovery complete", {
      routes: this.router.listRoutes().length,
    });
  }

  private commitRoutes(discoveredRouter: ApiRouteMatcher): void {
    const routes = discoveredRouter.listRoutes();
    this.router.clear();
    for (const route of routes) this.router.addRoute(route.pattern, route.page);
  }

  private async resolveRouteDirectories(): Promise<RouteDirectory[]> {
    const preferredRouter = this.config?.router;
    const appDir = normalizeRouteDirectory(this.config?.directories?.app ?? "app");
    const pagesDir = normalizeRouteDirectory(this.config?.directories?.pages ?? "pages");
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
            "The configured app router directory is missing. Using the pages router directory.",
          );
          results.push({ type: "pages", path: pagesFallback });
        }
      } else if (preferredRouter === "pages") {
        const appFallback = this.useRelativePaths ? appDir : join(this.projectDir, appDir);
        if (await this.directoryExists(appFallback)) {
          logger.warn(
            "The configured pages router directory is missing. Using the app router directory.",
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
        useRelativePaths: this.useRelativePaths,
      });

      const stat = await this.adapter.fs.stat(path);

      logger.debug("Directory stat result", { isDirectory: stat.isDirectory });
      return stat.isDirectory;
    } catch (error) {
      if (isMissingDirectoryError(error)) return false;
      throw error;
    }
  }

  private visitEntry(state: DiscoveryState): void {
    state.entriesVisited++;
    if (state.entriesVisited > MAX_DISCOVERY_ENTRIES) {
      throw new RangeError("Route discovery entry count exceeds the supported limit");
    }
  }

  private async discoverPagesRoutes(
    router: ApiRouteMatcher,
    dir: string,
    prefix: string,
    state: DiscoveryState,
    depth: number,
  ): Promise<void> {
    if (depth > MAX_DISCOVERY_DEPTH) {
      throw new RangeError("Route discovery depth exceeds the supported limit");
    }
    logger.debug("Reading pages route directory", { depth });

    for await (const entry of this.adapter.fs.readDir(dir)) {
      this.visitEntry(state);
      assertSafeDirectoryEntryName(entry.name);
      if (shouldSkipEntry(entry.name, dir)) continue;

      const fullPath = join(dir, entry.name);
      const routePath = `${prefix}/${entry.name.replace(/\.(tsx?|jsx?|mdx?)$/, "")}`.replace(
        /\/+/g,
        "/",
      );

      if (routePath.length > MAX_ROUTE_PATH_LENGTH) {
        throw new RangeError("Discovered route path exceeds the supported limit");
      }

      if (entry.isDirectory) {
        await this.discoverPagesRoutes(router, fullPath, routePath, state, depth + 1);
        continue;
      }

      if (!entry.isFile || !/\.(tsx?|jsx?|mdx?)$/.test(entry.name)) continue;
      if (routePath.startsWith("/api")) continue;

      let pattern = routePath.replace(/\/index$/, "") || "/";
      pattern = pattern.replace(/\/+/g, "/");

      const relativePath = this.toProjectRelativePath(fullPath);
      router.addRoute(pattern, relativePath);
    }
  }

  private async discoverAppRoutes(
    router: ApiRouteMatcher,
    dir: string,
    state: DiscoveryState,
  ): Promise<void> {
    await this.discoverAppRoutesRecursive(router, dir, [], state, 0);
  }

  private async discoverAppRoutesRecursive(
    router: ApiRouteMatcher,
    dir: string,
    segments: string[],
    state: DiscoveryState,
    depth: number,
  ): Promise<void> {
    if (depth > MAX_DISCOVERY_DEPTH) {
      throw new RangeError("Route discovery depth exceeds the supported limit");
    }
    logger.debug("Reading app route directory", { depth });

    for await (const entry of this.adapter.fs.readDir(dir)) {
      this.visitEntry(state);
      assertSafeDirectoryEntryName(entry.name);
      if (shouldSkipEntry(entry.name, dir)) continue;

      const fullPath = join(dir, entry.name);

      if (entry.isDirectory) {
        const normalizedSegment = this.normalizeAppPathSegment(entry.name);
        const nextSegments = normalizedSegment ? [...segments, normalizedSegment] : segments;
        await this.discoverAppRoutesRecursive(router, fullPath, nextSegments, state, depth + 1);
        continue;
      }

      if (!entry.isFile || !/^page\.(tsx?|ts|jsx?|js|mdx)$/.test(entry.name)) continue;

      const pattern = this.buildAppRoutePattern(segments);
      if (pattern.length > MAX_ROUTE_PATH_LENGTH) {
        throw new RangeError("Discovered route path exceeds the supported limit");
      }
      const relativePath = this.toProjectRelativePath(fullPath);
      router.addRoute(pattern, relativePath);
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
    const projectRelativePath = relative(this.projectDir, fullPath);
    if (
      projectRelativePath === ".." || projectRelativePath.startsWith(`..${sep}`) ||
      isAbsolute(projectRelativePath)
    ) {
      throw new TypeError("Discovered route escaped the project root");
    }
    return projectRelativePath.split(sep).join("/");
  }
}
