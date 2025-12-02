/**
 * Router Detection
 *
 * Determines whether to use App Router or Pages Router based on:
 * - Explicit configuration (config.router)
 * - Directory structure analysis
 * - Route file presence detection
 */

import { join } from "../platform/compat/path-helper.ts";
import { createFileSystem } from "../platform/compat/fs.ts";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import type { VeryfrontConfig } from "@veryfront/config";

// Re-export from app-route-resolver for backward compatibility
export { getAppRouteEntity } from "./app-route-resolver.ts";

// Re-export from route-params-extractor for backward compatibility
export { extractAppRouteParams, extractPagesRouteParams } from "./route-params-extractor.ts";

/**
 * Detect if app router should be used based on config and directory structure
 */
export async function detectAppRouter(
  projectDir: string,
  config: VeryfrontConfig,
  adapter: RuntimeAdapter,
): Promise<boolean> {
  const forced = config?.router;
  if (forced === "app") return true;
  if (forced === "pages") return false;

  // Check if app directory exists AND contains route files
  const appDirName = config?.directories?.app || "app";
  const pagesDirName = config?.directories?.pages || "pages";

  const appDir = join(projectDir, appDirName);
  const pagesDir = join(projectDir, pagesDirName);

  let hasAppRoutes = false;
  let hasPagesRoutes = false;

  const appStat = await statWithFallback(appDir, adapter);
  if (appStat?.isDirectory) {
    hasAppRoutes = await hasRouteFiles(appDir, adapter);
  }

  // Check for pages routes
  const pagesStat = await statWithFallback(pagesDir, adapter);
  if (pagesStat?.isDirectory) {
    hasPagesRoutes = await hasRouteFiles(pagesDir, adapter);
  }

  // If both have routes, prefer app router
  // If only one has routes, use that one
  if (hasAppRoutes) return true;
  if (hasPagesRoutes) return false;

  // If neither has routes, check which directory exists
  // Prefer app router for new projects, but allow pages router for legacy
  const hasAppDir = Boolean(appStat?.isDirectory);
  const hasPagesDir = Boolean(pagesStat?.isDirectory);

  // If both exist but neither has routes, prefer app router (modern default)
  // If only one exists, use that one
  // If neither exists, default to app router
  if (hasAppDir) return true; // Prefer app router when it exists
  if (hasPagesDir) return false;
  return false; // If nothing is detectable, fall back to pages router to avoid false positives
}

/**
 * Check if a directory contains route files
 */
async function hasRouteFiles(
  dir: string,
  adapter: RuntimeAdapter,
): Promise<boolean> {
  const routeExtensions = [".mdx", ".tsx", ".jsx", ".ts", ".js"];
  const routePatterns = ["page", "layout", "error", "loading", "not-found"];

  const entries = await readDirWithFallback(dir, adapter);
  for (const entry of entries) {
    if (entry.isFile) {
      const name = entry.name.toLowerCase();
      // Check if file matches a route pattern or is a valid route file
      const hasRouteExtension = routeExtensions.some((ext) => name.endsWith(ext));
      if (hasRouteExtension) {
        const isRouteFile = routePatterns.some((pattern) => name.startsWith(pattern));
        const isIndexFile = name.startsWith("index");
        if (isRouteFile || isIndexFile) {
          return true;
        }
      }
    } else if (entry.isDirectory) {
      // Recursively check subdirectories
      const hasNested = await hasRouteFiles(join(dir, entry.name), adapter);
      if (hasNested) return true;
    }
  }

  return false;
}

type NormalizedStat = {
  size?: number;
  isFile: boolean;
  isDirectory: boolean;
  isSymlink: boolean;
  mtime?: Date | null;
};

type NormalizedDirEntry = {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
  isSymlink: boolean;
};

async function statWithFallback(
  path: string,
  adapter: RuntimeAdapter,
): Promise<NormalizedStat | null> {
  try {
    return await adapter.fs.stat(path) as NormalizedStat;
  } catch {
    const fs = createFileSystem();
    try {
      const stat = await fs.stat(path);
      return {
        size: stat.size,
        isFile: stat.isFile,
        isDirectory: stat.isDirectory,
        isSymlink: stat.isSymlink,
        mtime: stat.mtime,
      };
    } catch {
      return null;
    }
  }
}

async function readDirWithFallback(
  dir: string,
  adapter: RuntimeAdapter,
): Promise<NormalizedDirEntry[]> {
  try {
    const entries: NormalizedDirEntry[] = [];
    for await (const entry of adapter.fs.readDir(dir)) {
      entries.push(entry as NormalizedDirEntry);
    }
    return entries;
  } catch {
    const fs = createFileSystem();
    try {
      const entries: NormalizedDirEntry[] = [];
      for await (const entry of fs.readDir(dir)) {
        entries.push({
          name: entry.name,
          isFile: entry.isFile,
          isDirectory: entry.isDirectory,
          isSymlink: "isSymlink" in entry ? (entry as any).isSymlink : false,
        });
      }
      return entries;
    } catch {
      return [];
    }
  }
}
