
import { serverLogger as logger } from "@veryfront/utils";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import { join, relative } from "std/path/mod.ts";
import type { AppRouteInfo, RouteInfo } from "./build-types.ts";
import { discoverFiles } from "@veryfront/core/utils/file-discovery.ts";

const PAGE_EXTENSIONS = [".mdx", ".tsx", ".jsx", ".ts"];

function convertToSlug(relativePath: string): string {
  return (
    relativePath
      .replace(/\\/g, "/")
      .replace(/\.(mdx|tsx|jsx|ts)$/, "")
      .replace(/\/index$/, "") || "index"
  );
}

function shouldIncludeRoute(
  path: string,
  include: string[] | undefined,
  exclude: string[] | undefined,
): boolean {
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
      const file of discoverFiles({
        baseDir: pagesDir,
        extensions: PAGE_EXTENSIONS,
        adapter,
      })
    ) {
      const relativePath = relative(pagesDir, file.path);
      const slug = convertToSlug(relativePath);
      const pathForRoute = `/${slug === "index" ? "" : slug}`;

      if (shouldIncludeRoute(pathForRoute, include, exclude)) {
        routes.push({ path: pathForRoute, file: file.path, slug });
      }
    }
  } catch (e) {
    logger.debug("No pages directory found, continuing with empty routes", e);
  }

  return routes;
}

export async function collectAppRoutes(
  adapter: RuntimeAdapter,
  projectDir: string,
  include?: string[],
  exclude?: string[],
): Promise<AppRouteInfo[]> {
  const collected: AppRouteInfo[] = [];

  try {
    const appRoot = join(projectDir, "app");
    await adapter.fs.stat(appRoot);
    await walkAppSSG(adapter, appRoot, [], [appRoot], collected);

    const filtered = collected.filter((r: AppRouteInfo) => {
      if (include?.length && !include.some((p) => r.path.startsWith(p))) return false;
      if (exclude?.length && exclude.some((p) => r.path.startsWith(p))) return false;
      return true;
    });

    logger.info(`Found ${collected.length} App Router static routes`);
    return filtered;
  } catch (e) {
    logger.debug("No app directory found for SSG", e);
    return [];
  }
}

const DYNAMIC_SEGMENT_PATTERNS = [/^\[.*\]$/, /^\[\.\.\..*\]$/, /^\[\[\.\.\..*\]\]$/];
const PAGE_CANDIDATES = ["page.tsx", "page.jsx", "page.ts", "page.js"];

function isDynamicSegment(dirName: string): boolean {
  return DYNAMIC_SEGMENT_PATTERNS.some((pattern) => pattern.test(dirName));
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
  const { join } = await import("std/path/mod.ts");
  const baseName = dir.split("/").pop() || "";

  if (isDynamicSegment(baseName)) {
    return;
  }
  const candidates = PAGE_CANDIDATES.map((n) => join(dir, n));
  for (const f of candidates) {
    try {
      const st = await adapter.fs.stat(f);
      if (st.isFile) {
        const src = await adapter.fs.readFile(f).catch(() => "");
        if (!isForceDynamic(src)) {
          const path = `/${segs.join("/")}`;
          collected.push({
            path: path === "/" ? "/" : path,
            pageFile: f,
            segments: [...segs],
            segmentDirs: [...segDirs],
          });
        }
        break;
      }
    } catch {
    }
  }
  for await (const e of adapter.fs.readDir(dir)) {
    if (!e.isDirectory) continue;
    await walkAppSSG(
      adapter,
      join(dir, e.name),
      e.name === "app" ? [] : [...segs, e.name],
      [...segDirs, join(dir, e.name)],
      collected,
    );
  }
}
