/**
 * Asset Generation for Build
 * Handles copying static assets from public directory
 */

import { serverLogger as logger } from "@veryfront/utils";
import { dirname, join, relative } from "node:path";
import { walk } from "std/fs/mod.ts";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";

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
  if (typeof Deno !== "undefined" && "errors" in Deno && Deno.errors.NotFound) {
    if (error instanceof Deno.errors.NotFound) return true;
  }
  return err.code === "ENOENT";
}

function toPathStat(
  info: Deno.FileInfo | PathStat | {
    size: number;
    isFile(): boolean;
    isDirectory(): boolean;
    isSymbolicLink(): boolean;
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

  if (typeof (info as { isFile(): boolean }).isFile === "function") {
    const stats = info as {
      size: number;
      isFile(): boolean;
      isDirectory(): boolean;
      isSymbolicLink(): boolean;
    };
    return {
      isFile: stats.isFile(),
      isDirectory: stats.isDirectory(),
      isSymlink: stats.isSymbolicLink(),
      size: stats.size,
    };
  }

  const denoInfo = info as unknown as Deno.FileInfo;
  return {
    isFile: denoInfo.isFile,
    isDirectory: denoInfo.isDirectory,
    isSymlink: denoInfo.isSymlink,
    size: denoInfo.size ?? 0,
  };
}

async function statPath(path: string, adapter: RuntimeAdapter): Promise<PathStat> {
  if (typeof Deno !== "undefined" && typeof Deno.lstat === "function") {
    try {
      const info = await Deno.lstat(path);
      return toPathStat(info);
    } catch (error) {
      if (!isNotFoundError(error)) {
        throw error;
      }
      // fall through to other strategies for not found to ensure consistent error types
    }
  }

  try {
    const fs = await import("node:fs/promises");
    const info = await fs.lstat(path);
    return toPathStat(
      info as unknown as {
        size: number;
        isFile(): boolean;
        isDirectory(): boolean;
        isSymbolicLink(): boolean;
      },
    );
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error;
    }
  }

  const adapterInfo = await adapter.fs.stat(path);
  return toPathStat(adapterInfo as unknown as PathStat);
}

async function ensureDirPath(path: string, adapter: RuntimeAdapter): Promise<void> {
  if (!path) return;

  if (typeof Deno !== "undefined" && typeof Deno.mkdir === "function") {
    try {
      await Deno.mkdir(path, { recursive: true });
      return;
    } catch (error) {
      if (
        error instanceof Deno.errors.AlreadyExists ||
        (typeof error === "object" && error !== null && "code" in error &&
          (error as { code?: string }).code === "EEXIST")
      ) {
        return;
      }
    }
  }

  try {
    const fs = await import("node:fs/promises");
    await fs.mkdir(path, { recursive: true });
    return;
  } catch (error) {
    if (
      typeof error === "object" && error !== null &&
      "code" in error &&
      ((error as { code?: string }).code === "EEXIST" ||
        (error as { code?: string }).code === "ERR_FS_EISDIR")
    ) {
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

  const destinationRoot = outputDir;

  const readFileBytes = async (path: string): Promise<Uint8Array> => {
    if (typeof Deno !== "undefined" && typeof Deno.readFile === "function") {
      return await Deno.readFile(path);
    }
    try {
      const fs = await import("node:fs/promises");
      const buffer = await fs.readFile(path);
      return buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    } catch (_error) {
      const text = await adapter.fs.readFile(path);
      return new TextEncoder().encode(text);
    }
  };

  const writeFileBytes = async (path: string, data: Uint8Array): Promise<void> => {
    if (typeof Deno !== "undefined" && typeof Deno.writeFile === "function") {
      await Deno.writeFile(path, data);
      return;
    }
    try {
      const fs = await import("node:fs/promises");
      await fs.writeFile(path, data);
    } catch (_error) {
      const text = new TextDecoder().decode(data);
      await adapter.fs.writeFile(path, text);
    }
  };

  if (!dryRun) {
    await ensureDirPath(destinationRoot, adapter);
    const testFilePath = join(destinationRoot, ".vf_write_test.tmp");
    const testBytes = new Uint8Array([0]);
    try {
      await writeFileBytes(testFilePath, testBytes);
      try {
        if (typeof Deno !== "undefined" && typeof Deno.remove === "function") {
          await Deno.remove(testFilePath);
        } else {
          const fs = await import("node:fs/promises");
          await fs.rm(testFilePath, { force: true });
        }
      } catch (_error) {
        // Best-effort cleanup; ignore failures to remove test file.
      }
    } catch (error) {
      throw error;
    }
  }

  for await (const entry of walk(publicDir, { followSymlinks: true, includeDirs: true })) {
    const relativePath = relative(publicDir, entry.path);

    if (!relativePath || relativePath === "" || relativePath.startsWith("..")) {
      continue;
    }

    const destinationPath = join(destinationRoot, relativePath);

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
 * Load CSS template from file
 */
export async function loadClientStyles(adapter: RuntimeAdapter): Promise<string> {
  const currentFileUrl = import.meta.url;
  const currentDir = dirname(new URL(currentFileUrl).pathname);
  const stylesPath = join(currentDir, "templates/client-styles.css");

  try {
    return await adapter.fs.readFile(stylesPath);
  } catch (error) {
    logger.warn("Could not load client styles template:", error);
    return ""; // Return empty string as fallback
  }
}
