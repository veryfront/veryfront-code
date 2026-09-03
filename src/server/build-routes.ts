/**
 * Route Collection and Discovery for Build
 */

import { serverLogger as logger } from "#veryfront/utils";
import { isNotFoundError } from "#veryfront/platform/compat/fs.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { join, relative } from "#veryfront/compat/path/index.ts";
import type { AppRouteInfo, RouteInfo } from "./build-types.ts";
import { discoverFiles } from "#veryfront/utils/file-discovery.ts";
import { isDynamicRoute, isDynamicSegment } from "#veryfront/utils/route-path-utils.ts";

const PAGE_EXTENSIONS = [".mdx", ".md", ".tsx", ".jsx", ".ts", ".js"];
const PAGE_CANDIDATES = ["page.mdx", "page.md", "page.tsx", "page.jsx", "page.ts", "page.js"];
const PAGES_LAYOUT_CANDIDATES = new Set(PAGE_EXTENSIONS.map((extension) => `layout${extension}`));

function convertToSlug(relativePath: string): string {
  return (
    relativePath
      .replace(/\\/g, "/")
      .replace(/\.(mdx|md|tsx|jsx|ts|js)$/, "")
      .replace(/\/index$/, "") || "index"
  );
}

function isPagesApiDirectoryDescendant(relativePath: string): boolean {
  return relativePath.replace(/\\/g, "/").startsWith("api/");
}

function isPagesLayoutFile(relativePath: string): boolean {
  const fileName = relativePath.replace(/\\/g, "/").split("/").pop();
  return fileName !== undefined && PAGES_LAYOUT_CANDIDATES.has(fileName.toLowerCase());
}

function shouldIncludeRoute(path: string, include?: string[], exclude?: string[]): boolean {
  if (include?.length && !include.some((p) => path.startsWith(p))) return false;
  if (exclude?.length && exclude.some((p) => path.startsWith(p))) return false;
  return true;
}

/**
 * Order two discovered routes by route path, then by source file.
 *
 * Discovery walks directories in `readDir` order, which the filesystem is free
 * to vary between machines and even between two checkouts on one machine (ext4
 * returns hash order, not creation or lexical order). Every build artifact
 * derived from the route list — the SSG page list, the route manifest, the
 * order pages are rendered in — would inherit that variation, so a build of one
 * commit would not reproduce byte for byte. Codepoint comparison keeps the
 * order independent of the host's locale and ICU data as well.
 */
function compareRoutesByPath(
  left: { path: string; file: string },
  right: { path: string; file: string },
): number {
  if (left.path !== right.path) return left.path < right.path ? -1 : 1;
  if (left.file === right.file) return 0;
  return left.file < right.file ? -1 : 1;
}

export async function collectPagesRoutes(
  adapter: RuntimeAdapter,
  projectDir: string,
  include?: string[],
  exclude?: string[],
  pagesDirectory = "pages",
): Promise<RouteInfo[]> {
  const routes: RouteInfo[] = [];
  const pagesDir = join(projectDir, pagesDirectory);

  try {
    await adapter.fs.stat(pagesDir);
  } catch (error) {
    if (isNotFoundError(error)) return routes;
    throw error;
  }

  for await (
    const file of discoverFiles({ baseDir: pagesDir, extensions: PAGE_EXTENSIONS, adapter })
  ) {
    const relativePath = relative(pagesDir, file.path);
    if (isPagesApiDirectoryDescendant(relativePath) || isPagesLayoutFile(relativePath)) continue;

    const slug = convertToSlug(relativePath);
    const pathForRoute = `/${slug === "index" ? "" : slug}`;
    if (isDynamicRoute(pathForRoute)) continue;

    if (!shouldIncludeRoute(pathForRoute, include, exclude)) continue;
    routes.push({ path: pathForRoute, file: file.path, slug });
  }

  return routes.sort(compareRoutesByPath);
}

/**
 * Collect App Router literal routes (static analyzable)
 */
export async function collectAppRoutes(
  adapter: RuntimeAdapter,
  projectDir: string,
  include?: string[],
  exclude?: string[],
  appDirectory = "app",
): Promise<AppRouteInfo[]> {
  const collected: AppRouteInfo[] = [];
  const appRoot = join(projectDir, appDirectory);

  try {
    await adapter.fs.stat(appRoot);
  } catch (error) {
    if (isNotFoundError(error)) return collected;
    throw error;
  }

  await walkAppSSG(adapter, appRoot, [], [appRoot], collected);

  logger.debug(`Found ${collected.length} App Router static routes`);

  return collected
    .filter((r) => shouldIncludeRoute(r.path, include, exclude))
    .sort((left, right) =>
      compareRoutesByPath(
        { path: left.path, file: left.pageFile },
        { path: right.path, file: right.pageFile },
      )
    );
}

function isForceDynamic(source: string): boolean {
  // Regex-based heuristic: matches the common `export const dynamic = "force-dynamic"`
  // declaration. Known limitations: will miss `"force-dynamic" as const`, template literals,
  // and re-exports; will false-positive on commented-out lines. AST parsing would be more
  // accurate but is too heavy for this build-time path.
  return /export\s+const\s+dynamic\s*=\s*["']force-dynamic["']/.test(source);
}

async function walkAppSSG(
  adapter: RuntimeAdapter,
  dir: string,
  segs: string[],
  segDirs: string[],
  collected: AppRouteInfo[],
): Promise<void> {
  const baseName = dir.split("/").pop() ?? "";
  if (isDynamicSegment(baseName)) return;

  for (const filePath of PAGE_CANDIDATES.map((n) => join(dir, n))) {
    let isFile = false;
    try {
      isFile = (await adapter.fs.stat(filePath)).isFile;
    } catch (error) {
      if (isNotFoundError(error)) continue;
      throw error;
    }
    if (!isFile) continue;

    const src = await adapter.fs.readFile(filePath);
    if (isForceDynamic(src)) break;

    const path = `/${segs.join("/")}`;
    collected.push({
      path: path === "/" ? "/" : path,
      pageFile: filePath,
      segments: [...segs],
      segmentDirs: [...segDirs],
    });
    break;
  }

  for await (const entry of adapter.fs.readDir(dir)) {
    if (!entry.isDirectory) continue;

    const nextDir = join(dir, entry.name);
    await walkAppSSG(
      adapter,
      nextDir,
      entry.name === "app" ? [] : [...segs, entry.name],
      [...segDirs, nextDir],
      collected,
    );
  }
}
