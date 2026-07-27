import { join } from "#veryfront/compat/path";
import { rendererLogger as logger } from "#veryfront/utils";
import { DYNAMIC_ROUTE_ERROR, FILE_NOT_FOUND, VeryfrontError } from "#veryfront/errors";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { isNotFoundError } from "#veryfront/platform/compat/fs.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import type { EntityInfo } from "#veryfront/types";
import { MAX_PATH_LENGTH_CHARS } from "#veryfront/utils/constants/limits.ts";
import { containsPathControlCharacters } from "#veryfront/utils/route-path-utils.ts";
import { getEntityBySlug } from "../entity-resolution.ts";
import {
  detectAppRouter,
  getAppRouteEntity,
  normalizeRouterDirectoryName,
  primeRouterDetectionCache,
} from "../router-detection.ts";

const PAGE_EXTENSIONS = /\.(mdx|md|tsx|jsx|ts|js)$/;
const APP_ROUTER_PAGE_PATTERN = /^page\.(mdx|md|tsx|jsx|ts|js)$/;
const MAX_DISCOVERY_DIRECTORIES = 1_024;
const MAX_DISCOVERY_ENTRIES = 100_000;
const MAX_DIRECTORY_ENTRIES = 10_000;
const MAX_DISCOVERED_PAGES = 10_000;

type DiscoveryEntry = {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
  isSymlink: boolean;
};

type DiscoveryBudget = {
  directoriesVisited: number;
  entriesInspected: number;
};

function isPageFile(name: string): boolean {
  return PAGE_EXTENSIONS.test(name);
}

function isAppRouterPageFile(name: string): boolean {
  return APP_ROUTER_PAGE_PATTERN.test(name);
}

function fileToSlug(name: string): string {
  const slug = name.replace(PAGE_EXTENSIONS, "");
  return slug === "index" ? "/" : slug;
}

function pagesFileToSlug(relativePath: string, name: string): string {
  const stem = name.replace(PAGE_EXTENSIONS, "");
  if (stem === "index") return relativePath || "/";
  return relativePath ? `${relativePath}/${stem}` : stem;
}

function appDirToSlug(dirPath: string, appDirName: string): string {
  let relativePath = dirPath;

  if (dirPath === appDirName) {
    relativePath = "";
  } else if (dirPath.startsWith(`${appDirName}/`)) {
    relativePath = dirPath.slice(appDirName.length + 1);
  }

  return relativePath === "" ? "/" : `/${relativePath}`;
}

function isSafeDirectoryEntryName(name: string): boolean {
  return name.length > 0 &&
    name.length <= MAX_PATH_LENGTH_CHARS &&
    name !== "." &&
    name !== ".." &&
    !name.includes("/") &&
    !name.includes("\\") &&
    !containsPathControlCharacters(name);
}

function shouldSkipDirectory(name: string): boolean {
  return name === "node_modules" || name.startsWith(".");
}

function isPagesRouterInternalFile(name: string): boolean {
  const stem = name.replace(PAGE_EXTENSIONS, "");
  return stem === "_app" || stem === "_document" || stem === "_error";
}

export interface PageResolverOptions {
  projectDir: string;
  projectId?: string;
  config: VeryfrontConfig;
  adapter: RuntimeAdapter;
}

export class PageResolver {
  private projectDir: string;
  private projectId?: string;
  private config: VeryfrontConfig;
  private adapter: RuntimeAdapter;

  constructor(options: PageResolverOptions) {
    this.projectDir = options.projectDir;
    this.projectId = options.projectId;
    this.config = options.config;
    this.adapter = options.adapter;
  }

  resolvePage(slug: string): Promise<EntityInfo> {
    return withSpan(
      "routing.resolve_page",
      async () => {
        const appDirName = normalizeRouterDirectoryName(
          this.config.directories?.app,
          "app",
        );
        const pagesDirName = normalizeRouterDirectoryName(
          this.config.directories?.pages,
          "pages",
        );
        const cacheKey = this.projectId ?? this.projectDir;

        let pageInfo: EntityInfo | null | undefined;

        if (this.config.router === "app") {
          pageInfo = await getAppRouteEntity(
            this.projectDir,
            slug,
            this.adapter,
            appDirName,
          );
          if (pageInfo) {
            primeRouterDetectionCache(cacheKey, "app", this.config);
          }
        } else if (this.config.router === "pages") {
          pageInfo = await getEntityBySlug(
            this.projectDir,
            slug,
            this.adapter,
            pagesDirName,
          );
          if (pageInfo) {
            primeRouterDetectionCache(cacheKey, "pages", this.config);
          }
        } else {
          // Auto mode stays structural: detect the dominant router once, then keep
          // pages fallback available for mixed or in-transition projects.
          const useAppRouter = await detectAppRouter(
            this.projectDir,
            this.config,
            this.adapter,
            { projectId: this.projectId },
          );

          if (useAppRouter) {
            pageInfo = await getAppRouteEntity(
              this.projectDir,
              slug,
              this.adapter,
              appDirName,
            );
            if (!pageInfo) {
              pageInfo = await getEntityBySlug(
                this.projectDir,
                slug,
                this.adapter,
                pagesDirName,
              );
            }
          } else {
            pageInfo = await getEntityBySlug(
              this.projectDir,
              slug,
              this.adapter,
              pagesDirName,
            );
          }
        }

        if (!pageInfo) {
          throw FILE_NOT_FOUND.create({
            detail: `Page not found: ${slug}`,
            context: { slug, router: this.config.router ?? "auto" },
          });
        }

        return pageInfo;
      },
      {
        "routing.slug": slug,
        "routing.project_dir": this.projectDir,
      },
    );
  }

  async getAllPages(): Promise<string[]> {
    const pages = new Set<string>();
    const pagesDirName = normalizeRouterDirectoryName(
      this.config.directories?.pages,
      "pages",
    );
    const appDirName = normalizeRouterDirectoryName(
      this.config.directories?.app,
      "app",
    );
    const budget: DiscoveryBudget = {
      directoriesVisited: 0,
      entriesInspected: 0,
    };

    const appDir = join(this.projectDir, appDirName);
    if (await this.adapter.fs.exists(appDir)) {
      await this.discoverAppRouterPages(
        appDir,
        appDirName,
        pages,
        appDirName,
        budget,
      );
    }

    const pagesDir = join(this.projectDir, pagesDirName);
    if (await this.adapter.fs.exists(pagesDir)) {
      await this.discoverPagesRouterPages(pagesDir, pages, "", budget);
    }

    const rootEntries = await this.readDirectoryEntries(this.projectDir, budget);
    for (const entry of rootEntries) {
      if (!entry.isFile || !isPageFile(entry.name) || entry.name.includes("config")) {
        continue;
      }
      this.addPage(pages, fileToSlug(entry.name));
    }

    const result = Array.from(pages);
    logger.debug("Discovered pages:", {
      count: result.length,
      pages: result.slice(0, 100),
      pagesTruncated: result.length > 100,
      sources: { app: appDir, pages: pagesDir },
    });

    return result;
  }

  private async discoverAppRouterPages(
    currentDir: string,
    appDirName: string,
    pages: Set<string>,
    relativePath: string = appDirName,
    budget: DiscoveryBudget = {
      directoriesVisited: 0,
      entriesInspected: 0,
    },
  ): Promise<void> {
    const entries = await this.readDirectoryEntries(currentDir, budget);
    for (const entry of entries) {
      if (!isSafeDirectoryEntryName(entry.name) || entry.isSymlink) continue;

      if (entry.isFile && isAppRouterPageFile(entry.name)) {
        this.addPage(pages, appDirToSlug(relativePath, appDirName));
        continue;
      }

      if (!entry.isDirectory || shouldSkipDirectory(entry.name)) continue;

      const dirName = entry.name;
      const isRouteGroup = dirName.startsWith("(");
      const isParallelRoute = dirName.startsWith("@");
      const isPrivateFolder = dirName.startsWith("_");

      if (isParallelRoute || isPrivateFolder) continue;

      if (isRouteGroup) {
        await this.discoverAppRouterPages(
          join(currentDir, dirName),
          appDirName,
          pages,
          relativePath,
          budget,
        );
        continue;
      }

      await this.discoverAppRouterPages(
        join(currentDir, dirName),
        appDirName,
        pages,
        `${relativePath}/${dirName}`,
        budget,
      );
    }
  }

  private async discoverPagesRouterPages(
    currentDir: string,
    pages: Set<string>,
    relativePath: string,
    budget: DiscoveryBudget,
  ): Promise<void> {
    const entries = await this.readDirectoryEntries(currentDir, budget);

    for (const entry of entries) {
      if (!isSafeDirectoryEntryName(entry.name) || entry.isSymlink) continue;

      if (
        entry.isFile &&
        isPageFile(entry.name) &&
        !isPagesRouterInternalFile(entry.name)
      ) {
        this.addPage(pages, pagesFileToSlug(relativePath, entry.name));
        continue;
      }

      if (
        !entry.isDirectory ||
        entry.name === "api" ||
        shouldSkipDirectory(entry.name)
      ) {
        continue;
      }

      const childRelativePath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
      await this.discoverPagesRouterPages(
        join(currentDir, entry.name),
        pages,
        childRelativePath,
        budget,
      );
    }
  }

  private async readDirectoryEntries(
    dir: string,
    budget: DiscoveryBudget,
  ): Promise<DiscoveryEntry[]> {
    budget.directoriesVisited += 1;
    if (budget.directoriesVisited > MAX_DISCOVERY_DIRECTORIES) {
      throw DYNAMIC_ROUTE_ERROR.create({
        detail: `Page discovery exceeds the ${MAX_DISCOVERY_DIRECTORIES}-directory limit`,
      });
    }

    const entries: DiscoveryEntry[] = [];
    try {
      for await (const value of this.adapter.fs.readDir(dir) as AsyncIterable<unknown>) {
        if (entries.length >= MAX_DIRECTORY_ENTRIES) {
          throw DYNAMIC_ROUTE_ERROR.create({
            detail: `Page directory listing exceeds the ${MAX_DIRECTORY_ENTRIES}-entry limit`,
          });
        }
        budget.entriesInspected += 1;
        if (budget.entriesInspected > MAX_DISCOVERY_ENTRIES) {
          throw DYNAMIC_ROUTE_ERROR.create({
            detail: `Page discovery exceeds the ${MAX_DISCOVERY_ENTRIES}-entry limit`,
          });
        }

        entries.push(this.snapshotDirectoryEntry(value));
      }
    } catch (error) {
      if (isNotFoundError(error)) return [];
      throw error;
    }
    return entries;
  }

  private snapshotDirectoryEntry(value: unknown): DiscoveryEntry {
    if (typeof value !== "object" || value === null) {
      throw DYNAMIC_ROUTE_ERROR.create({
        detail: "Page filesystem adapter returned an invalid directory entry",
      });
    }

    const entry = value as Partial<DiscoveryEntry>;
    if (
      typeof entry.name !== "string" ||
      typeof entry.isFile !== "boolean" ||
      typeof entry.isDirectory !== "boolean" ||
      (entry.isSymlink !== undefined && typeof entry.isSymlink !== "boolean")
    ) {
      throw DYNAMIC_ROUTE_ERROR.create({
        detail: "Page filesystem adapter returned an invalid directory entry",
      });
    }

    return {
      name: entry.name,
      isFile: entry.isFile,
      isDirectory: entry.isDirectory,
      isSymlink: entry.isSymlink ?? false,
    };
  }

  private addPage(pages: Set<string>, slug: string): void {
    if (pages.has(slug)) return;
    if (pages.size >= MAX_DISCOVERED_PAGES) {
      throw DYNAMIC_ROUTE_ERROR.create({
        detail: `Page discovery exceeds the ${MAX_DISCOVERED_PAGES}-page limit`,
      });
    }
    pages.add(slug);
  }

  async pageExists(slug: string): Promise<boolean> {
    try {
      await this.resolvePage(slug);
      return true;
    } catch (error: unknown) {
      if (error instanceof VeryfrontError && error.slug === "file-not-found") {
        return false;
      }
      throw error;
    }
  }

  async getRouterMode(): Promise<"app" | "pages"> {
    const useAppRouter = await detectAppRouter(
      this.projectDir,
      this.config,
      this.adapter,
      { projectId: this.projectId },
    );
    return useAppRouter ? "app" : "pages";
  }
}
