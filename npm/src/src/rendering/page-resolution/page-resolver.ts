import { join } from "../../platform/compat/path-helper.js";
import { rendererLogger as logger } from "../../utils/index.js";
import { ErrorCode, VeryfrontError } from "../../errors/index.js";
import { withSpan } from "../../observability/tracing/otlp-setup.js";
import type { RuntimeAdapter } from "../../platform/adapters/base.js";
import type { VeryfrontConfig } from "../../config/index.js";
import type { EntityInfo } from "../../types/index.js";
import { getEntityBySlug } from "../../types/entities/getEntityInfo.js";
import { detectAppRouter, getAppRouteEntity } from "../router-detection.js";

const PAGE_EXTENSIONS = /\.(mdx|md|tsx|jsx|ts|js)$/;

function isPageFile(name: string): boolean {
  return PAGE_EXTENSIONS.test(name);
}

function fileToSlug(name: string): string {
  const slug = name.replace(PAGE_EXTENSIONS, "");
  return slug === "index" ? "/" : slug;
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
            pageInfo = await getEntityBySlug(this.projectDir, slug, this.adapter);
          }
        } else {
          pageInfo = await getEntityBySlug(this.projectDir, slug, this.adapter);
        }

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
    logger.debug("Discovered pages:", { count: result.length, pages: result });

    return result;
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
