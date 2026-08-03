/**
 * Shared cache file operations for safe write/verify/import of cached modules.
 *
 * Both the SSR module loader and MDX ESM module writer use these functions
 * to ensure consistent, robust file handling across all cache code paths.
 */

import { type FileSystem, isNotFoundError } from "#veryfront/platform/compat/fs.ts";
import { redactPathFromText } from "#veryfront/utils/logger/redact.ts";
import { rendererLogger as logger } from "#veryfront/utils";

function describeCacheError(error: unknown, ...paths: string[]): string {
  const raw = error instanceof Error ? error.message : String(error);
  return paths.reduce(
    (message, path) => redactPathFromText(message, path, "[path]"),
    raw,
  );
}

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
      error: describeCacheError(mkdirError, path, parentDir),
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
      error: describeCacheError(writeError, path, parentDir),
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
      error: describeCacheError(verifyError, path, parentDir),
    });
    if (isNotFoundError(verifyError)) return false;
    throw verifyError;
  }

  return true;
}

/**
 * Verify a cache file exists before attempting dynamic import.
 * Returns true if the file exists and is a regular file, false when the path
 * is genuinely absent or is not a regular file. Non-absence stat failures
 * (EACCES, EIO, ...) are
 * rethrown so callers do not misreport an unreadable cache as a cache miss
 * and loop forever re-transforming the same module.
 */
export async function verifyCacheFileExists(
  fs: FileSystem,
  path: string,
  label = "cache",
): Promise<boolean> {
  try {
    const stat = await fs.stat(path);
    return !!stat?.isFile;
  } catch (error) {
    if (isNotFoundError(error)) return false;
    logger.debug(`[${label}] Cache file existence check failed`, {
      path: path.slice(-80),
      error: describeCacheError(error, path),
    });
    throw error;
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

  // EINVAL (os error 22) on some platforms when a path component is gone.
  // Prefer a structured errno code when present; the string match is brittle
  // and kept only as a fallback for runtimes that don't expose `code`.
  if ("code" in error && (error as Record<string, unknown>).code === "EINVAL") return true;
  if (error instanceof TypeError && error.message.includes("os error 22")) return true;

  return false;
}
