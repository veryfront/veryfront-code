import { join } from "../../platform/compat/path-helper.js";
import { rendererLogger as logger } from "../../utils/index.js";
import { ErrorCode, VeryfrontError } from "../../errors/index.js";
import { withSpan } from "../../observability/tracing/otlp-setup.js";
import { getEntityBySlug } from "../../types/entities/getEntityInfo.js";
import { detectAppRouter, getAppRouteEntity } from "../router-detection.js";
const PAGE_EXTENSIONS = /\.(mdx|md|tsx|jsx|ts|js)$/;
/** App Router page file pattern (page.tsx, page.js, etc.) */
const APP_ROUTER_PAGE_PATTERN = /^page\.(mdx|md|tsx|jsx|ts|js)$/;
function isPageFile(name) {
    return PAGE_EXTENSIONS.test(name);
}
function isAppRouterPageFile(name) {
    return APP_ROUTER_PAGE_PATTERN.test(name);
}
function fileToSlug(name) {
    const slug = name.replace(PAGE_EXTENSIONS, "");
    return slug === "index" ? "/" : slug;
}
/**
 * Convert App Router directory path to slug.
 * E.g., "app/blog/post" -> "/blog/post"
 *       "app" -> "/"
 */
function appDirToSlug(dirPath, appDirName) {
    // Remove the app directory prefix
    const relativePath = dirPath.startsWith(appDirName + "/")
        ? dirPath.slice(appDirName.length + 1)
        : dirPath === appDirName
            ? ""
            : dirPath;
    // Convert to slug
    return relativePath === "" ? "/" : `/${relativePath}`;
}
export class PageResolver {
    projectDir;
    config;
    adapter;
    constructor(options) {
        this.projectDir = options.projectDir;
        this.config = options.config;
        this.adapter = options.adapter;
    }
    resolvePage(slug) {
        return withSpan("routing.resolve_page", async () => {
            const useAppRouter = await detectAppRouter(this.projectDir, this.config, this.adapter);
            const appDirName = this.config.directories?.app ?? "app";
            let pageInfo;
            if (useAppRouter) {
                pageInfo = await getAppRouteEntity(this.projectDir, slug, this.adapter, appDirName);
                if (!pageInfo) {
                    logger.debug("App Router resolution failed, falling back to Pages Router", { slug });
                    pageInfo = await getEntityBySlug(this.projectDir, slug, this.adapter);
                }
            }
            else {
                pageInfo = await getEntityBySlug(this.projectDir, slug, this.adapter);
            }
            if (!pageInfo) {
                throw new VeryfrontError(`Page not found: ${slug}`, ErrorCode.FILE_NOT_FOUND, { slug, useAppRouter });
            }
            return pageInfo;
        }, {
            "routing.slug": slug,
            "routing.project_dir": this.projectDir,
        });
    }
    /**
     * Discover all pages from both App Router and Pages Router directories.
     * This is used for SSG to determine which pages need to be statically generated.
     *
     * @see plans/architecture-audit/005.2-ssg-getallpages-missing-app-router.md
     */
    async getAllPages() {
        const pages = new Set();
        const pagesDirName = this.config.directories?.pages ?? "pages";
        const appDirName = this.config.directories?.app ?? "app";
        // Discover App Router pages (app/ directory)
        const appDir = join(this.projectDir, appDirName);
        if (await this.adapter.fs.exists(appDir)) {
            await this.discoverAppRouterPages(appDir, appDirName, pages);
        }
        // Discover Pages Router pages (pages/ directory)
        const pagesDir = join(this.projectDir, pagesDirName);
        if (await this.adapter.fs.exists(pagesDir)) {
            for await (const entry of this.adapter.fs.readDir(pagesDir)) {
                if (entry.isFile && isPageFile(entry.name)) {
                    pages.add(fileToSlug(entry.name));
                }
            }
        }
        // Discover root-level pages (for backwards compatibility)
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
    /**
     * Recursively discover all page.tsx files in the App Router directory.
     * Handles route groups (parentheses) and parallel routes (@).
     */
    async discoverAppRouterPages(currentDir, appDirName, pages, relativePath = appDirName) {
        try {
            for await (const entry of this.adapter.fs.readDir(currentDir)) {
                if (entry.isFile && isAppRouterPageFile(entry.name)) {
                    // Found a page file, convert directory path to slug
                    const slug = appDirToSlug(relativePath, appDirName);
                    pages.add(slug);
                }
                else if (entry.isDirectory) {
                    const dirName = entry.name;
                    // Skip route groups (parentheses) - they don't add to the URL path
                    // Skip parallel routes (@) - they're slots, not pages
                    // Skip private folders (_) - they're not routable
                    if (dirName.startsWith("(") || dirName.startsWith("@") || dirName.startsWith("_")) {
                        // For route groups, recurse but don't include in path
                        if (dirName.startsWith("(")) {
                            await this.discoverAppRouterPages(join(currentDir, dirName), appDirName, pages, relativePath);
                        }
                        continue;
                    }
                    // Recurse into subdirectory
                    await this.discoverAppRouterPages(join(currentDir, dirName), appDirName, pages, `${relativePath}/${dirName}`);
                }
            }
        }
        catch (error) {
            // Directory might not exist or be inaccessible
            logger.debug("Failed to read App Router directory", {
                dir: currentDir,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }
    async pageExists(slug) {
        try {
            await this.resolvePage(slug);
            return true;
        }
        catch (error) {
            if (error instanceof VeryfrontError && error.code === ErrorCode.FILE_NOT_FOUND) {
                return false;
            }
            throw error;
        }
    }
    async getRouterMode() {
        const useAppRouter = await detectAppRouter(this.projectDir, this.config, this.adapter);
        return useAppRouter ? "app" : "pages";
    }
}
