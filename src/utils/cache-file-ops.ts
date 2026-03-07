/**
 * Shared cache file operations for safe write/verify/import of cached modules.
 *
 * Both the SSR module loader and MDX ESM module writer use these functions
 * to ensure consistent, robust file handling across all cache code paths.
 */

import type { FileSystem } from "#veryfront/platform/compat/fs.ts";
import { rendererLogger as logger } from "#veryfront/utils";

/**
 * Safely write a cache file: mkdir parent dir → write file → verify file exists.
 *
 * Throws on write failure (after logging context). Returns `false` if the parent
 * directory was removed concurrently (cache cleanup race), which callers should
 * treat as a skippable condition.
 */
export async function writeCacheFile(
  fs: FileSystem,
  path: string,
  content: string,
  label = "cache",
): Promise<boolean> {
  const parentDir = path.substring(0, path.lastIndexOf("/"));

  try {
    await fs.mkdir(parentDir, { recursive: true });
  } catch (mkdirError) {
    logger.debug(`[${label}] mkdir failed for cache file parent`, {
      path: path.slice(-80),
      dir: parentDir.slice(-80),
      error: mkdirError instanceof Error ? mkdirError.message : String(mkdirError),
    });
    throw mkdirError;
  }

  try {
    await fs.writeTextFile(path, content);
  } catch (writeError) {
    // ENOENT / NotFound / os error 22 = parent dir was removed concurrently (cache cleanup race)
    if (isCacheWriteRaceError(writeError)) {
      logger.debug(`[${label}] Cache write skipped (directory removed during write)`, {
        path: path.slice(-80),
      });
      return false;
    }
    logger.debug(`[${label}] Failed to write cache file`, {
      path: path.slice(-80),
      error: writeError instanceof Error ? writeError.message : String(writeError),
    });
    throw writeError;
  }

  // Verify the file was actually written
  try {
    const stat = await fs.stat(path);
    if (!stat?.isFile) {
      logger.debug(`[${label}] Cache file verification failed: not a file after write`, {
        path: path.slice(-80),
      });
      return false;
    }
  } catch (verifyError) {
    logger.debug(`[${label}] Cache file verification failed: cannot stat after write`, {
      path: path.slice(-80),
      error: verifyError instanceof Error ? verifyError.message : String(verifyError),
    });
    return false;
  }

  return true;
}

/**
 * Verify a cache file exists before attempting dynamic import.
 * Returns true if file exists and is a regular file, false otherwise.
 */
export async function verifyCacheFileExists(
  fs: FileSystem,
  path: string,
  _label = "cache",
): Promise<boolean> {
  try {
    const stat = await fs.stat(path);
    return !!stat?.isFile;
  } catch (_) {
    /* expected: file may not exist */
    return false;
  }
}

/**
 * Check if a write error is caused by a concurrent cache cleanup race
 * (directory removed between mkdir and write).
 */
export function isCacheWriteRaceError(error: unknown): boolean {
  if (error == null || typeof error !== "object") return false;

  if ("code" in error && (error as Record<string, unknown>).code === "ENOENT") return true;

  // Deno-specific NotFound
  if (typeof Deno !== "undefined" && error instanceof Deno.errors.NotFound) return true;

  // os error 22 (EINVAL) on some platforms when path component is gone
  if (error instanceof TypeError && error.message.includes("os error 22")) return true;

  return false;
}
