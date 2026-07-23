/**
 * Shared cache file operations for safe write/verify/import of cached modules.
 *
 * Both the SSR module loader and MDX ESM module writer use these functions
 * to ensure consistent, robust file handling across all cache code paths.
 */

import type { FileSystem } from "#veryfront/platform/compat/fs.ts";
import { dirname } from "#veryfront/compat/path/basic-operations.ts";
import { rendererLogger as logger } from "./logger/logger.ts";
import { generateUuid } from "./id.ts";

export interface WriteCacheFileOptions {
  /** Create the parent directory before writing. Disable this for indexes that must not resurrect a cleared cache. */
  createParent?: boolean;
}

async function removeTemporaryCacheFile(
  fs: FileSystem,
  temporaryPath: string,
  label: string,
): Promise<void> {
  try {
    await fs.remove(temporaryPath);
  } catch (error) {
    logger.debug(`[${label}] Failed to clean up temporary cache file`, {
      errorName: error instanceof Error ? error.name : typeof error,
    });
  }
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
  options: WriteCacheFileOptions = {},
): Promise<boolean> {
  const parentDir = dirname(path);

  if (options.createParent !== false) {
    try {
      await fs.mkdir(parentDir, { recursive: true });
    } catch (mkdirError) {
      logger.debug(`[${label}] mkdir failed for cache file parent`, {
        errorName: mkdirError instanceof Error ? mkdirError.name : typeof mkdirError,
      });
      throw mkdirError;
    }
  }

  const rename = fs.rename?.bind(fs);
  const temporaryPath = rename ? `${path}.tmp-${generateUuid()}` : undefined;
  const writePath = temporaryPath ?? path;
  try {
    await fs.writeTextFile(writePath, content);
  } catch (writeError) {
    if (temporaryPath) await removeTemporaryCacheFile(fs, temporaryPath, label);
    // ENOENT / NotFound / os error 22 = parent dir was removed concurrently (cache cleanup race)
    if (isCacheWriteRaceError(writeError)) {
      logger.debug(`[${label}] Cache write skipped (directory removed during write)`);
      return false;
    }
    logger.debug(`[${label}] Failed to write cache file`, {
      errorName: writeError instanceof Error ? writeError.name : typeof writeError,
    });
    throw writeError;
  }

  if (rename && temporaryPath) {
    try {
      await rename(temporaryPath, path);
    } catch (renameError) {
      await removeTemporaryCacheFile(fs, temporaryPath, label);
      if (isCacheWriteRaceError(renameError)) {
        logger.debug(`[${label}] Cache write skipped (directory removed during replacement)`);
        return false;
      }
      logger.debug(`[${label}] Failed to replace cache file`, {
        errorName: renameError instanceof Error ? renameError.name : typeof renameError,
      });
      throw renameError;
    }
  }

  // Verify the file was actually written
  try {
    const stat = await fs.stat(path);
    if (!stat?.isFile) {
      logger.debug(`[${label}] Cache file verification failed: not a file after write`);
      return false;
    }
  } catch (verifyError) {
    logger.debug(`[${label}] Cache file verification failed: cannot stat after write`, {
      errorName: verifyError instanceof Error ? verifyError.name : typeof verifyError,
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

  // EINVAL (os error 22) on some platforms when a path component is gone.
  // Prefer a structured errno code when present; the string match is brittle
  // and kept only as a fallback for runtimes that don't expose `code`.
  if ("code" in error && (error as Record<string, unknown>).code === "EINVAL") return true;
  if (error instanceof TypeError && error.message.includes("os error 22")) return true;

  return false;
}
