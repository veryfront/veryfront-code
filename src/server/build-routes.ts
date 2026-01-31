/**
 * Route Collection and Discovery for Build
 */

import { serverLogger as logger } from "#veryfront/utils";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { join, relative } from "#veryfront/platform/compat/path/index.ts";
import type { AppRouteInfo, RouteInfo } from "./build-types.ts";
import { discoverFiles } from "#veryfront/utils/file-discovery.ts";
import { isDynamicSegment } from "#veryfront/utils/route-path-utils.ts";

const PAGE_EXTENSIONS = [".mdx", ".md", ".tsx", ".jsx", ".ts"];
const PAGE_CANDIDATES = ["page.mdx", "page.md", "page.tsx", "page.jsx", "page.ts", "page.js"];

function convertToSlug(relativePath: string): string {
  return (
    relativePath
      .replace(/\\/g, "/")
      .replace(/\.(mdx|md|tsx|jsx|ts)$/, "")
      .replace(/\/index$/, "") || "index"
  );
}

function shouldIncludeRoute(path: string, include?: string[], exclude?: string[]): boolean {
  if (include?.length && !include.some((p) => path.startsWith(p))) return false;
  if (exclude?.length && exclude.some((p) => path.startsWith(p))) return false;
  return true;
}

export async function collectPagesRoutes(
  adapter: RuntimeAdapter,
  projectDir: string,
  include?: string[],
  exclude?: string[],
): Promise<RouteInfo[]> {
  const routes: RouteInfo[] = [];

  try {
    const pagesDir = join(projectDir, "pages");
    await adapter.fs.stat(pagesDir);

    for await (
      const file of discoverFiles({ baseDir: pagesDir, extensions: PAGE_EXTENSIONS, adapter })
    ) {
      const relativePath = relative(pagesDir, file.path);
      const slug = convertToSlug(relativePath);
      const pathForRoute = `/${slug === "index" ? "" : slug}`;

      if (!shouldIncludeRoute(pathForRoute, include, exclude)) continue;
      routes.push({ path: pathForRoute, file: file.path, slug });
    }
  } catch (e) {
    logger.debug("No pages directory found, continuing with empty routes", e);
  }

  return routes;
}

/**
 * Collect App Router literal routes (static analyzable)
 */
export async function collectAppRoutes(
  adapter: RuntimeAdapter,
  projectDir: string,
  include?: string[],
  exclude?: string[],
): Promise<AppRouteInfo[]> {
  try {
    const collected: AppRouteInfo[] = [];
    const appRoot = join(projectDir, "app");

    await adapter.fs.stat(appRoot);
    await walkAppSSG(adapter, appRoot, [], [appRoot], collected);

    logger.debug(`Found ${collected.length} App Router static routes`);

    return collected.filter((r) => shouldIncludeRoute(r.path, include, exclude));
  } catch (e) {
    logger.debug("No app directory found for SSG", e);
    return [];
  }
}

function isForceDynamic(source: string): boolean {
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
    try {
      const st = await adapter.fs.stat(filePath);
      if (!st.isFile) continue;

      const src = (await adapter.fs.readFile(filePath).catch(() => "")) ?? "";
      if (isForceDynamic(src)) break;

      const path = `/${segs.join("/")}`;
      collected.push({
        path: path === "/" ? "/" : path,
        pageFile: filePath,
        segments: [...segs],
        segmentDirs: [...segDirs],
      });
      break;
    } catch {
      // continue
    }
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
