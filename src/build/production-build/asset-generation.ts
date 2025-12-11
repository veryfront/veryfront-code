
import { serverLogger as logger } from "@veryfront/utils";
import { dirname, join, relative } from "node:path";
import { walk } from "std/fs/mod.ts";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import { CLIENT_STYLES } from "./templates.ts";
import { createFileSystem } from "../../platform/compat/fs.ts";

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

async function ensureDirPath(path: string, adapter: RuntimeAdapter): Promise<void> {
  if (!path) return;

  const fs = createFileSystem();
  try {
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
    const fs = createFileSystem();
    const buffer = await fs.readFile(path);
    return buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  };

  const writeFileBytes = async (path: string, data: Uint8Array): Promise<void> => {
    const fs = createFileSystem();
    await fs.writeFile(path, data);
  };

  if (!dryRun) {
    await ensureDirPath(destinationRoot, adapter);
    const testFilePath = join(destinationRoot, ".vf_write_test.tmp");
    const testBytes = new Uint8Array([0]);
    try {
      await writeFileBytes(testFilePath, testBytes);
      try {
        const fs = createFileSystem();
        await fs.remove(testFilePath);
      } catch (_error) {
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

export function loadClientStyles(): string {
  return CLIENT_STYLES;
}
