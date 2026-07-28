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
import { BUILD_FAILED } from "#veryfront/errors";

const logger = serverLogger.component("build");
const MAX_STATIC_ASSET_PATH_LENGTH = 4_096;
const RESERVED_PUBLIC_ROOTS = new Set(["_veryfront", "_vf"]);
const RESERVED_PUBLIC_FILES = new Set(["sw.js", "_redirects"]);

export interface AssetStats {
  assets: number;
  totalSize: number;
}

export interface StaticAssetEntry {
  sourcePath: string;
  relativePath: string;
  kind: "file" | "directory";
  size: number;
}

async function pathExists(path: string): Promise<boolean> {
  const fs = createFileSystem();
  try {
    await fs.stat(path);
    return true;
  } catch (error) {
    if (isNotFoundError(error)) return false;
    throw error;
  }
}

export async function discoverStaticAssets(projectDir: string): Promise<StaticAssetEntry[]> {
  const fs = createFileSystem();
  const publicDir = join(projectDir, "public");

  let publicInfo;
  try {
    publicInfo = await fs.stat(publicDir);
  } catch (error) {
    if (isNotFoundError(error)) return [];
    throw error;
  }
  if (!publicInfo.isDirectory) {
    throw BUILD_FAILED.create({ detail: `Public asset path is not a directory: ${publicDir}` });
  }

  const entries: StaticAssetEntry[] = [];
  for await (const entry of walk(publicDir, { followSymlinks: false, includeDirs: true })) {
    const relativePath = relative(publicDir, entry.path).replaceAll("\\", "/");
    if (!relativePath || relativePath === ".") continue;
    const firstSegment = relativePath.split("/")[0]?.toLocaleLowerCase("en-US");
    if (
      (firstSegment && RESERVED_PUBLIC_ROOTS.has(firstSegment)) ||
      RESERVED_PUBLIC_FILES.has(relativePath.toLocaleLowerCase("en-US"))
    ) {
      throw BUILD_FAILED.create({
        detail: `Public asset path is reserved for generated build output: ${relativePath}`,
      });
    }

    if (
      relativePath.length > MAX_STATIC_ASSET_PATH_LENGTH ||
      relativePath.startsWith("/") ||
      relativePath.split("/").some((segment) =>
        segment === "" || segment === "." || segment === ".."
      )
    ) {
      throw BUILD_FAILED.create({
        detail: `Invalid public asset path: ${relativePath}`,
      });
    }
    if (entry.isSymlink) {
      throw BUILD_FAILED.create({
        detail: `Symbolic links are not supported in public assets: ${relativePath}`,
      });
    }
    if (!entry.isFile && !entry.isDirectory) continue;
    const size = entry.isFile ? (await fs.stat(entry.path)).size : 0;

    entries.push({
      sourcePath: entry.path,
      relativePath,
      kind: entry.isDirectory ? "directory" : "file",
      size,
    });
  }

  return entries.sort((left, right) => {
    const depth = left.relativePath.split("/").length -
      right.relativePath.split("/").length;
    return depth || left.relativePath.localeCompare(right.relativePath);
  });
}

/**
 * Copy static assets from public directory to output directory
 */
export async function copyStaticAssets(
  _adapter: RuntimeAdapter,
  projectDir: string,
  outputDir: string,
  dryRun = false,
): Promise<AssetStats> {
  const stats: AssetStats = { assets: 0, totalSize: 0 };
  const fs = createFileSystem();
  const entries = await discoverStaticAssets(projectDir);
  if (entries.length === 0) {
    logger.debug("No public assets found");
    return stats;
  }

  for (const entry of entries) {
    const destinationPath = join(outputDir, entry.relativePath);

    if (entry.kind === "directory") {
      if (!dryRun) {
        if (await pathExists(destinationPath)) {
          const info = await fs.stat(destinationPath);
          if (!info.isDirectory) {
            throw BUILD_FAILED.create({
              detail: `Public directory collides with generated output: ${entry.relativePath}`,
            });
          }
        } else {
          await fs.mkdir(destinationPath, { recursive: true });
        }
      }
      continue;
    }

    stats.assets += 1;
    stats.totalSize += entry.size;
    if (dryRun) continue;

    if (await pathExists(destinationPath)) {
      throw BUILD_FAILED.create({
        detail: `Public asset would overwrite generated output: ${entry.relativePath}`,
      });
    }

    await fs.mkdir(dirname(destinationPath), { recursive: true });
    await fs.writeFile(destinationPath, await fs.readFile(entry.sourcePath));
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
