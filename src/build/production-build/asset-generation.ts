/**
 * Asset Generation for Build
 * Handles copying static assets from public directory
 */

import { serverLogger as logger } from "@veryfront/utils";
import { dirname, join, relative } from "@veryfront/platform/compat/path/index.ts";
import { walk } from "std/fs/mod.ts";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import { CLIENT_STYLES } from "./templates.ts";
import { createFileSystem } from "@veryfront/platform/compat/fs.ts";

export interface AssetStats {
  assets: number;
  totalSize: number;
}

interface PathStat {
  isFile: boolean;
  isDirectory: boolean;
  isSymlink: boolean;
  size: number;
}

function isNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const err = error as { code?: string };
  return err.code === "ENOENT";
}

/**
 * Converts various file info formats to a normalized PathStat.
 * Supports both property-based (Deno-style) and method-based (Node.js-style) file info.
 */
function toPathStat(
  info: PathStat | {
    size: number;
    isFile: boolean | (() => boolean);
    isDirectory: boolean | (() => boolean);
    isSymlink?: boolean;
    isSymbolicLink?: () => boolean;
  },
): PathStat {
  if ("isFile" in info && typeof info.isFile === "boolean") {
    const typed = info as PathStat;
    return {
      isFile: typed.isFile,
      isDirectory: typed.isDirectory,
      isSymlink: typed.isSymlink,
      size: typed.size,
    };
  }

  // Handle method-based file info (Node.js style)
  if (typeof info.isFile === "function") {
    const isFileFn = info.isFile as () => boolean;
    const isDirFn = info.isDirectory as () => boolean;
    const isSymlinkFn = (info as { isSymbolicLink?: () => boolean }).isSymbolicLink;
    return {
      isFile: isFileFn(),
      isDirectory: isDirFn(),
      isSymlink: isSymlinkFn ? isSymlinkFn() : false,
      size: info.size,
    };
  }

  // Handle property-based file info (Deno style)
  return {
    isFile: info.isFile as boolean,
    isDirectory: info.isDirectory as boolean,
    isSymlink: (info as { isSymlink?: boolean }).isSymlink ?? false,
    size: info.size ?? 0,
  };
}

async function statPath(path: string, adapter: RuntimeAdapter): Promise<PathStat> {
  try {
    const fs = createFileSystem();
    const info = await fs.stat(path);
    return toPathStat(info as unknown as PathStat);
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error;
    }
    const adapterInfo = await adapter.fs.stat(path);
    return toPathStat(adapterInfo as unknown as PathStat);
  }
}

function isDirectoryExistsError(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("code" in error)) return false;
  const code = (error as { code?: string }).code;
  return code === "EEXIST" || code === "ERR_FS_EISDIR";
}

async function ensureDirPath(path: string, adapter: RuntimeAdapter): Promise<void> {
  if (!path) return;

  const fs = createFileSystem();
  try {
    await fs.mkdir(path, { recursive: true });
    return;
  } catch (error) {
    if (isDirectoryExistsError(error)) {
      return;
    }
  }

  await adapter.fs.mkdir(path, { recursive: true });
}

/**
 * Copy static assets from public directory to output directory
 */
export async function copyStaticAssets(
  adapter: RuntimeAdapter,
  projectDir: string,
  outputDir: string,
  dryRun = false,
): Promise<AssetStats> {
  const stats: AssetStats = { assets: 0, totalSize: 0 };
  const publicDir = join(projectDir, "public");

  let publicDirInfo: PathStat;
  try {
    publicDirInfo = await statPath(publicDir, adapter);
  } catch (error) {
    if (isNotFoundError(error)) {
      logger.debug("[build] No public directory found, skipping static assets");
      return stats;
    }
    throw error;
  }

  if (!publicDirInfo.isDirectory) {
    logger.debug("[build] Public path is not a directory, skipping static assets", {
      publicDir,
    });
    return stats;
  }

  const fs = createFileSystem();

  const readFileBytes = async (path: string): Promise<Uint8Array> => {
    const buffer = await fs.readFile(path);
    return buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  };

  const writeFileBytes = async (path: string, data: Uint8Array): Promise<void> => {
    await fs.writeFile(path, data);
  };

  // Verify write access by creating and removing a test file
  if (!dryRun) {
    await ensureDirPath(outputDir, adapter);
    const testFilePath = join(outputDir, ".vf_write_test.tmp");
    await writeFileBytes(testFilePath, new Uint8Array([0]));
    try {
      await fs.remove(testFilePath);
    } catch (_error) {
      // Best-effort cleanup; ignore failures to remove test file.
    }
  }

  for await (const entry of walk(publicDir, { followSymlinks: true, includeDirs: true })) {
    const relativePath = relative(publicDir, entry.path);

    if (!relativePath || relativePath === "" || relativePath.startsWith("..")) {
      continue;
    }

    const destinationPath = join(outputDir, relativePath);

    if (entry.isDirectory) {
      if (!dryRun) {
        await ensureDirPath(destinationPath, adapter);
      }
      continue;
    }

    try {
      const fileInfo = await statPath(entry.path, adapter);
      if (!fileInfo.isFile && !fileInfo.isSymlink) {
        continue;
      }

      stats.assets += 1;
      stats.totalSize += fileInfo.size;

      if (!dryRun) {
        await ensureDirPath(dirname(destinationPath), adapter);
        const bytes = await readFileBytes(entry.path);
        await writeFileBytes(destinationPath, bytes);
      }
    } catch (error) {
      logger.debug("[build] Failed to copy static asset", { path: entry.path, error });
      throw error;
    }
  }

  logger.info(`Copied ${stats.assets} static assets`);
  return stats;
}

/**
 * Load CSS template (embedded for npm compatibility)
 */
export function loadClientStyles(): string {
  return CLIENT_STYLES;
}
