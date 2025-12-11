
import { join } from "../platform/compat/path-helper.ts";
import { createFileSystem } from "../platform/compat/fs.ts";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import type { VeryfrontConfig } from "@veryfront/config";

export { getAppRouteEntity } from "./app-route-resolver.ts";

export { extractAppRouteParams, extractPagesRouteParams } from "./route-params-extractor.ts";

export async function detectAppRouter(
  projectDir: string,
  config: VeryfrontConfig,
  adapter: RuntimeAdapter,
): Promise<boolean> {
  const forced = config?.router;
  if (forced === "app") return true;
  if (forced === "pages") return false;

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

  const pagesStat = await statWithFallback(pagesDir, adapter);
  if (pagesStat?.isDirectory) {
    hasPagesRoutes = await hasRouteFiles(pagesDir, adapter);
  }

  if (hasAppRoutes) return true;
  if (hasPagesRoutes) return false;

  const hasAppDir = Boolean(appStat?.isDirectory);
  const hasPagesDir = Boolean(pagesStat?.isDirectory);

  if (hasAppDir) return true;
  if (hasPagesDir) return false;
  return false;
}

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
