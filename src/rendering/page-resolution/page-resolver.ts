/**
 * PageResolver - Page Entity Resolution
 *
 * Handles:
 * - Router mode detection (App Router vs Pages Router)
 * - Slug-to-entity resolution
 * - Fallback logic (App Router → Pages Router)
 * - Page discovery for static generation
 *
 * This module is critical for routing - it determines which file
 * to use for a given URL slug and handles both routing modes.
 */

import { join } from "@veryfront/platform/compat/path-helper.ts";
import { rendererLogger as logger } from "@veryfront/utils";
import { ErrorCode, VeryfrontError } from "@veryfront/errors/index.ts";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import type { VeryfrontConfig } from "@veryfront/config";
import type { EntityInfo } from "@veryfront/types";
import { getEntityBySlug } from "@veryfront/types/entities/getEntityInfo.ts";
import { detectAppRouter, getAppRouteEntity } from "../router-detection.ts";

/** Supported page file extensions */
const PAGE_EXTENSIONS = /\.(mdx|md|tsx|jsx|ts|js)$/;

/** Check if a filename is a page file */
function isPageFile(name: string): boolean {
  return PAGE_EXTENSIONS.test(name);
}

/** Extract slug from page filename */
function fileToSlug(name: string): string {
  const slug = name.replace(PAGE_EXTENSIONS, "");
  return slug === "index" ? "/" : slug;
}

export interface PageResolverOptions {
  projectDir: string;
  config: VeryfrontConfig;
  adapter: RuntimeAdapter;
}

/**
 * Resolves page entities based on slug and router mode
 */
export class PageResolver {
  private projectDir: string;
  private config: VeryfrontConfig;
  private adapter: RuntimeAdapter;

  constructor(options: PageResolverOptions) {
    this.projectDir = options.projectDir;
    this.config = options.config;
    this.adapter = options.adapter;
  }

  /**
   * Resolve a page entity from a slug
   *
   * Handles both App Router and Pages Router modes with fallback:
   * 1. Detect router mode (App vs Pages)
   * 2. Try App Router resolution if App mode
   * 3. Try Pages Router resolution as fallback
   * 4. Throw error if page not found
   *
   * @param slug - URL slug to resolve (e.g., "blog/post")
   * @returns EntityInfo for the page
   * @throws VeryfrontError if page not found
   */
  async resolvePage(slug: string): Promise<EntityInfo> {
    // Detect which router mode to use
    const useAppRouter = await detectAppRouter(
      this.projectDir,
      this.config,
      this.adapter,
    );

    const appDirName = this.config?.directories?.app || "app";

    // Try App Router resolution first if enabled
    let pageInfo = useAppRouter
      ? await getAppRouteEntity(this.projectDir, slug, this.adapter, appDirName)
      : await getEntityBySlug(this.projectDir, slug, this.adapter);

    // Fallback to Pages Router if App Router didn't find the page
    // This allows mixed routing modes during migration
    if (!pageInfo && useAppRouter) {
      logger.debug("App Router resolution failed, falling back to Pages Router", { slug });
      pageInfo = await getEntityBySlug(this.projectDir, slug, this.adapter);
    }

    // Page not found in either mode
    if (!pageInfo) {
      throw new VeryfrontError(
        `Page not found: ${slug}`,
        ErrorCode.FILE_NOT_FOUND,
        { slug, useAppRouter },
      );
    }

    return pageInfo;
  }

  /**
   * Get all pages for static generation
   *
   * Discovers all page files in the project:
   * - Checks pages/ directory
   * - Checks project root
   * - Handles all supported file extensions (.mdx, .md, .tsx, .jsx, .ts, .js)
   * - Converts file names to slugs
   * - Handles index pages (converts to "/")
   * - Deduplicates pages
   *
   * @returns Array of slugs for all pages
   */
  async getAllPages(): Promise<string[]> {
    const pages = new Set<string>();
    const pagesDirName = this.config?.directories?.pages || "pages";

    // Check pages directory
    const pagesDir = join(this.projectDir, pagesDirName);
    if (await this.adapter.fs.exists(pagesDir)) {
      for await (const entry of this.adapter.fs.readDir(pagesDir)) {
        if (entry.isFile && isPageFile(entry.name)) {
          pages.add(fileToSlug(entry.name));
        }
      }
    }

    // Also check root directory (Set handles deduplication)
    for await (const entry of this.adapter.fs.readDir(this.projectDir)) {
      if (entry.isFile && isPageFile(entry.name) && !entry.name.includes("config")) {
        pages.add(fileToSlug(entry.name));
      }
    }

    const result = Array.from(pages);
    logger.debug("Discovered pages:", { count: result.length, pages: result });

    return result;
  }

  /**
   * Check if a page exists for a given slug
   *
   * @param slug - URL slug to check
   * @returns true if page exists, false otherwise
   */
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

  /**
   * Get the router mode for the project
   *
   * @returns "app" if App Router is enabled, "pages" otherwise
   */
  async getRouterMode(): Promise<"app" | "pages"> {
    const useAppRouter = await detectAppRouter(
      this.projectDir,
      this.config,
      this.adapter,
    );
    return useAppRouter ? "app" : "pages";
  }
}
