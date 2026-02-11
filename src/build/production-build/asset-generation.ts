/**
 * Asset Generation for Build
 * Handles copying static assets from public directory
 */

import { serverLogger } from "#veryfront/utils";
import { dirname, join, relative } from "#veryfront/compat/path/index.ts";
import { walk } from "#std/fs.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { CLIENT_STYLES } from "./templates.ts";
import { createFileSystem, isNotFoundError } from "#veryfront/platform/compat/fs.ts";

const logger = serverLogger.component("build");

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
  if (typeof info.isFile === "function") {
    return {
      isFile: info.isFile(),
      isDirectory: (info.isDirectory as () => boolean)(),
      isSymlink: info.isSymbolicLink?.() ?? false,
      size: info.size,
    };
  }

  return {
    isFile: info.isFile as boolean,
    isDirectory: info.isDirectory as boolean,
    isSymlink: info.isSymlink ?? false,
    size: info.size ?? 0,
  };
}

async function statPath(path: string, adapter: RuntimeAdapter): Promise<PathStat> {
  const fs = createFileSystem();

  try {
    return toPathStat(await fs.stat(path));
  } catch (error) {
    if (!isNotFoundError(error)) throw error;
  }

  return toPathStat(await adapter.fs.stat(path));
}

function isDirectoryExistsError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
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
    if (isDirectoryExistsError(error)) return;
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
      logger.debug("No public directory found, skipping static assets");
      return stats;
    }
    throw error;
  }

  if (!publicDirInfo.isDirectory) {
    logger.debug("Public path is not a directory, skipping static assets", { publicDir });
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
    } catch {
      // Best-effort cleanup; ignore failures to remove test file.
    }
  }

  for await (const entry of walk(publicDir, { followSymlinks: true, includeDirs: true })) {
    const relativePath = relative(publicDir, entry.path);
    if (!relativePath || relativePath.startsWith("..")) continue;

    const destinationPath = join(outputDir, relativePath);

    if (entry.isDirectory) {
      if (!dryRun) await ensureDirPath(destinationPath, adapter);
      continue;
    }

    try {
      const fileInfo = await statPath(entry.path, adapter);
      if (!fileInfo.isFile && !fileInfo.isSymlink) continue;

      stats.assets += 1;
      stats.totalSize += fileInfo.size;

      if (dryRun) continue;

      await ensureDirPath(dirname(destinationPath), adapter);
      await writeFileBytes(destinationPath, await readFileBytes(entry.path));
    } catch (error) {
      logger.debug("Failed to copy static asset", { path: entry.path, error });
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
