import { join } from "#veryfront/platform/compat/path-helper.ts";
import { rendererLogger as logger } from "#veryfront/utils";
import { ErrorCode, VeryfrontError } from "#veryfront/errors/index.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import type { EntityInfo } from "#veryfront/types";
import { getEntityBySlug } from "#veryfront/types/entities/getEntityInfo.ts";
import { detectAppRouter, getAppRouteEntity } from "../router-detection.ts";

const PAGE_EXTENSIONS = /\.(mdx|md|tsx|jsx|ts|js)$/;
const APP_ROUTER_PAGE_PATTERN = /^page\.(mdx|md|tsx|jsx|ts|js)$/;

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

function appDirToSlug(dirPath: string, appDirName: string): string {
  let relativePath = dirPath;

  if (dirPath === appDirName) {
    relativePath = "";
  } else if (dirPath.startsWith(`${appDirName}/`)) {
    relativePath = dirPath.slice(appDirName.length + 1);
  }

  return relativePath === "" ? "/" : `/${relativePath}`;
}

export interface PageResolverOptions {
  projectDir: string;
  config: VeryfrontConfig;
  adapter: RuntimeAdapter;
}

export class PageResolver {
  private projectDir: string;
  private config: VeryfrontConfig;
  private adapter: RuntimeAdapter;

  constructor(options: PageResolverOptions) {
    this.projectDir = options.projectDir;
    this.config = options.config;
    this.adapter = options.adapter;
  }

  resolvePage(slug: string): Promise<EntityInfo> {
    return withSpan(
      "routing.resolve_page",
      async () => {
        const useAppRouter = await detectAppRouter(
          this.projectDir,
          this.config,
          this.adapter,
        );

        const appDirName = this.config.directories?.app ?? "app";

        let pageInfo: EntityInfo | null | undefined;

        if (useAppRouter) {
          pageInfo = await getAppRouteEntity(
            this.projectDir,
            slug,
            this.adapter,
            appDirName,
          );

          if (!pageInfo) {
            logger.debug(
              "App Router resolution failed, falling back to Pages Router",
              { slug },
            );
          }
        }

        pageInfo ??= await getEntityBySlug(this.projectDir, slug, this.adapter);

        if (!pageInfo) {
          throw new VeryfrontError(
            `Page not found: ${slug}`,
            ErrorCode.FILE_NOT_FOUND,
            { slug, useAppRouter },
          );
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
    const pagesDirName = this.config.directories?.pages ?? "pages";
    const appDirName = this.config.directories?.app ?? "app";

    const appDir = join(this.projectDir, appDirName);
    if (await this.adapter.fs.exists(appDir)) {
      await this.discoverAppRouterPages(appDir, appDirName, pages);
    }

    const pagesDir = join(this.projectDir, pagesDirName);
    if (await this.adapter.fs.exists(pagesDir)) {
      for await (const entry of this.adapter.fs.readDir(pagesDir)) {
        if (entry.isFile && isPageFile(entry.name)) {
          pages.add(fileToSlug(entry.name));
        }
      }
    }

    for await (const entry of this.adapter.fs.readDir(this.projectDir)) {
      if (!entry.isFile || !isPageFile(entry.name) || entry.name.includes("config")) {
        continue;
      }
      pages.add(fileToSlug(entry.name));
    }

    const result = Array.from(pages);
    logger.debug("Discovered pages:", {
      count: result.length,
      pages: result,
      sources: { app: appDir, pages: pagesDir },
    });

    return result;
  }

  private async discoverAppRouterPages(
    currentDir: string,
    appDirName: string,
    pages: Set<string>,
    relativePath: string = appDirName,
  ): Promise<void> {
    try {
      for await (const entry of this.adapter.fs.readDir(currentDir)) {
        if (entry.isFile && isAppRouterPageFile(entry.name)) {
          pages.add(appDirToSlug(relativePath, appDirName));
          continue;
        }

        if (!entry.isDirectory) {
          continue;
        }

        const dirName = entry.name;

        const isRouteGroup = dirName.startsWith("(");
        const isParallelRoute = dirName.startsWith("@");
        const isPrivateFolder = dirName.startsWith("_");

        if (isParallelRoute || isPrivateFolder) {
          continue;
        }

        if (isRouteGroup) {
          await this.discoverAppRouterPages(
            join(currentDir, dirName),
            appDirName,
            pages,
            relativePath,
          );
          continue;
        }

        await this.discoverAppRouterPages(
          join(currentDir, dirName),
          appDirName,
          pages,
          `${relativePath}/${dirName}`,
        );
      }
    } catch (error) {
      logger.debug("Failed to read App Router directory", {
        dir: currentDir,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async pageExists(slug: string): Promise<boolean> {
    try {
      await this.resolvePage(slug);
      return true;
    } catch (error: unknown) {
      if (error instanceof VeryfrontError && error.code === ErrorCode.FILE_NOT_FOUND) {
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
    );
    return useAppRouter ? "app" : "pages";
  }
}
