
import { join } from "../../platform/compat/path-helper.ts";
import { rendererLogger as logger } from "@veryfront/utils";
import { ErrorCode, VeryfrontError } from "@veryfront/errors/index.ts";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import type { VeryfrontConfig } from "@veryfront/config";
import type { EntityInfo } from "@veryfront/types";
import { getEntityBySlug } from "../../core/types/entities/getEntityInfo.ts";
import { detectAppRouter, getAppRouteEntity } from "../router-detection.ts";

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

  async resolvePage(slug: string): Promise<EntityInfo> {
    const useAppRouter = await detectAppRouter(
      this.projectDir,
      this.config,
      this.adapter,
    );

    logger.info("Router mode:", {
      useAppRouter,
      projectDir: this.projectDir,
      slug,
    });

    const appDirName = this.config?.directories?.app || "app";

    let pageInfo = useAppRouter
      ? await getAppRouteEntity(this.projectDir, slug, this.adapter, appDirName)
      : await getEntityBySlug(this.projectDir, slug, this.adapter);

    if (!pageInfo && useAppRouter) {
      logger.debug("App Router resolution failed, falling back to Pages Router", {
        slug,
      });
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
  }

  async getAllPages(): Promise<string[]> {
    const pages: string[] = [];
    const pagesDirName = this.config?.directories?.pages || "pages";

    const pagesDir = join(this.projectDir, pagesDirName);
    if (await this.adapter.fs.exists(pagesDir)) {
      for await (const entry of this.adapter.fs.readDir(pagesDir)) {
        if (
          entry.isFile &&
          (entry.name.endsWith(".mdx") ||
            entry.name.endsWith(".tsx") ||
            entry.name.endsWith(".jsx") ||
            entry.name.endsWith(".ts") ||
            entry.name.endsWith(".js"))
        ) {
          const slug = entry.name.replace(/\.(mdx|tsx|jsx|ts|js)$/, "");
          pages.push(slug === "index" ? "/" : slug);
        }
      }
    }

    for await (const entry of this.adapter.fs.readDir(this.projectDir)) {
      if (
        entry.isFile &&
        (entry.name.endsWith(".mdx") ||
          entry.name.endsWith(".tsx") ||
          entry.name.endsWith(".jsx") ||
          entry.name.endsWith(".ts") ||
          entry.name.endsWith(".js")) &&
        !entry.name.includes("config")
      ) {
        const slug = entry.name.replace(/\.(mdx|tsx|jsx|ts|js)$/, "");
        if (!pages.includes(slug === "index" ? "/" : slug)) {
          pages.push(slug === "index" ? "/" : slug);
        }
      }
    }

    logger.debug("Discovered pages:", { count: pages.length, pages });

    return pages;
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
