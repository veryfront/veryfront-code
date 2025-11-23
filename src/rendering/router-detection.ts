/**
 * Router Detection
 *
 * Determines whether to use App Router or Pages Router based on:
 * - Explicit configuration (config.router)
 * - Directory structure analysis
 * - Route file presence detection
 */

import { join } from "https://deno.land/std@0.220.0/path/mod.ts";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import type { VeryfrontConfig } from "@veryfront/config";
import { withFallback } from "@veryfront/platform/adapters/index.ts";

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

  // Check for app routes
  try {
    const appStat = await withFallback(
      () => adapter.fs.stat(appDir),
      () => Deno.stat(appDir),
      { operationName: "stat:detectAppRouter:appDir", logError: false },
    );
    if (appStat.isDirectory) {
      hasAppRoutes = await hasRouteFiles(appDir, adapter);
    }
  } catch {
    /* ignore */
  }

  // Check for pages routes
  try {
    const pagesStat = await adapter.fs.stat(pagesDir);
    if (pagesStat.isDirectory) {
      hasPagesRoutes = await hasRouteFiles(pagesDir, adapter);
    }
  } catch {
    try {
      const info = await Deno.stat(pagesDir);
      if (info.isDirectory) {
        hasPagesRoutes = await hasRouteFiles(pagesDir, adapter);
      }
    } catch {
      /* ignore */
    }
  }

  // If both have routes, prefer app router
  // If only one has routes, use that one
  if (hasAppRoutes) return true;
  if (hasPagesRoutes) return false;

  // If neither has routes, check which directory exists
  // Prefer app router for new projects, but allow pages router for legacy
  let hasAppDir = false;
  let hasPagesDir = false;

  try {
    await adapter.fs.stat(appDir);
    hasAppDir = true;
  } catch {
    try {
      await Deno.stat(appDir);
      hasAppDir = true;
    } catch {
      /* ignore */
    }
  }

  try {
    await adapter.fs.stat(pagesDir);
    hasPagesDir = true;
  } catch {
    try {
      await Deno.stat(pagesDir);
      hasPagesDir = true;
    } catch {
      /* ignore */
    }
  }

  // If both exist but neither has routes, prefer app router (modern default)
  // If only one exists, use that one
  // If neither exists, default to app router
  if (hasAppDir) return true; // Prefer app router when it exists
  if (hasPagesDir) return false;
  return true; // Default to app router for new projects
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

  try {
    const entries = await adapter.fs.readDir(dir);
    for await (const entry of entries) {
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
  } catch {
    // Fallback to Deno.readDir if adapter doesn't support it
    try {
      for await (const entry of Deno.readDir(dir)) {
        if (entry.isFile) {
          const name = entry.name.toLowerCase();
          const hasRouteExtension = routeExtensions.some((ext) => name.endsWith(ext));
          if (hasRouteExtension) {
            const isRouteFile = routePatterns.some((pattern) => name.startsWith(pattern));
            const isIndexFile = name.startsWith("index");
            if (isRouteFile || isIndexFile) {
              return true;
            }
          }
        } else if (entry.isDirectory) {
          const hasNested = await hasRouteFiles(join(dir, entry.name), adapter);
          if (hasNested) return true;
        }
      }
    } catch {
      /* ignore read errors */
    }
  }

  return false;
}
