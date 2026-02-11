/**
 * Styles Candidate Scanner
 *
 * Extracts Tailwind CSS candidate class names from project source files.
 * Supports two strategies: FS adapter with getAllSourceFiles() for remote/proxy
 * mode, and local filesystem scanning as fallback for local development.
 *
 * @module server/handlers/dev/styles-candidate-scanner
 */

import { extractCandidates } from "#veryfront/html/styles-builder/tailwind-compiler.ts";
import { serverLogger as logger } from "#veryfront/utils";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { join } from "#veryfront/compat/path/index.ts";
import type { HandlerContext } from "../types.ts";

const log = logger.component("styles-candidate-scanner");

const SOURCE_EXTENSIONS = [".tsx", ".jsx", ".mdx", ".ts", ".js"];
const SKIP_DIRS = new Set(["node_modules", ".cache", ".git", "dist", "build", ".vscode"]);

/**
 * Extract Tailwind CSS candidate class names from all project source files.
 *
 * Tries the FS adapter's `getAllSourceFiles()` first (available in proxy/remote
 * mode). Falls back to recursive local directory scanning when no adapter or
 * method is available (local dev mode).
 */
export async function extractProjectCandidates(ctx: HandlerContext): Promise<Set<string>> {
  const wrappedFs = ctx.adapter.fs as { getUnderlyingAdapter?: () => unknown };

  if (typeof wrappedFs.getUnderlyingAdapter !== "function") {
    logger.debug(
      "[StylesCandidateScanner] No FS adapter wrapper, falling back to local file scanning",
    );
    return scanLocalFiles(ctx.projectDir, ctx);
  }

  // Call method directly on wrappedFs to preserve 'this' context
  const fsAdapter = wrappedFs.getUnderlyingAdapter() as {
    getAllSourceFiles?: () =>
      | Array<{ path: string; content?: string }>
      | Promise<Array<{ path: string; content?: string }>>;
  };

  if (typeof fsAdapter.getAllSourceFiles !== "function") {
    logger.debug(
      "[StylesCandidateScanner] FS adapter missing getAllSourceFiles, falling back to local file scanning",
    );
    return scanLocalFiles(ctx.projectDir, ctx);
  }

  const candidates = new Set<string>();
  const files = await fsAdapter.getAllSourceFiles();

  for (const file of files) {
    if (!file.content) continue;
    if (!SOURCE_EXTENSIONS.some((ext) => file.path.endsWith(ext))) continue;

    for (const cls of extractCandidates(file.content)) {
      candidates.add(cls);
    }
  }

  return candidates;
}

/**
 * Fallback: scan local files for Tailwind candidates when no FS adapter is available.
 * Used in local development mode where projects are read directly from disk.
 */
async function scanLocalFiles(projectDir: string, ctx: HandlerContext): Promise<Set<string>> {
  const candidates = new Set<string>();
  const fs = createFileSystem();

  const scanDir = async (dir: string): Promise<void> => {
    let entries: AsyncIterable<{ name: string; isDirectory: boolean; isFile: boolean }>;
    try {
      entries = fs.readDir(dir);
    } catch {
      return;
    }

    for await (const entry of entries) {
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory) {
        if (!SKIP_DIRS.has(entry.name)) await scanDir(fullPath);
        continue;
      }

      if (!entry.isFile) continue;
      if (!SOURCE_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) continue;

      try {
        const content = await ctx.adapter.fs.readFile(fullPath);
        for (const cls of extractCandidates(content)) candidates.add(cls);
      } catch {
        // Skip files that can't be read
      }
    }
  };

  try {
    await scanDir(projectDir);
    log.debug("Local file scan complete", {
      projectDir,
      candidates: candidates.size,
    });
  } catch (error) {
    log.warn("Failed to scan local files", {
      projectDir,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return candidates;
}
