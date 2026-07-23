/**
 * Asset Generation for Build
 * Handles copying static assets from public directory
 */

import { serverLogger } from "#veryfront/utils";
import { dirname, isAbsolute, join, relative, resolve } from "#veryfront/compat/path/index.ts";
import { walk } from "#std/fs.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { CLIENT_STYLES } from "./templates.ts";
import { createFileSystem, isNotFoundError } from "#veryfront/platform/compat/fs.ts";
import { BUILD_FAILED } from "#veryfront/errors";
import { hasUnsafeControlCharacters } from "#veryfront/errors/text-validation.ts";

const logger = serverLogger.component("build");

/** Counts and source bytes for copied public assets. */
export interface AssetStats {
  assets: number;
  totalSize: number;
}

const RESERVED_PUBLIC_OUTPUT_PREFIXES = ["_veryfront/", "_vf/"] as const;
const RESERVED_PUBLIC_OUTPUT_PATHS = new Set(["sw.js", "_redirects"]);

function assertPublicOutputPath(
  relativePath: string,
  additionalReservedPaths: ReadonlySet<string>,
): void {
  const normalized = relativePath.replaceAll("\\", "/").replace(/^\.\//, "");
  if (
    !normalized || isAbsolute(relativePath) || /^[A-Za-z]:\//.test(normalized) ||
    hasUnsafeControlCharacters(normalized) || normalized.includes("?") ||
    normalized.includes("#") || normalized.includes(":") ||
    normalized.split("/").some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new TypeError("Public assets must use safe relative paths");
  }
  const reserved = RESERVED_PUBLIC_OUTPUT_PATHS.has(normalized) ||
    additionalReservedPaths.has(normalized) ||
    RESERVED_PUBLIC_OUTPUT_PREFIXES.some((prefix) => normalized.startsWith(prefix));
  if (!reserved) return;

  throw BUILD_FAILED.create({
    detail: `Public asset uses reserved build output path: ${normalized}`,
  });
}

async function assertCanonicalPublicDirectory(
  projectDir: string,
  publicDir: string,
): Promise<void> {
  const fs = createFileSystem();
  if (fs.lstat) {
    const info = await fs.lstat(publicDir);
    if (info.isSymlink) throw new TypeError("The project public path must not be a symbolic link");
  }
  if (!fs.realPath) return;

  const [canonicalProjectDir, canonicalPublicDir] = await Promise.all([
    fs.realPath(projectDir),
    fs.realPath(publicDir),
  ]);
  const canonicalRelativePath = relative(canonicalProjectDir, canonicalPublicDir);
  if (
    canonicalRelativePath === "" || canonicalRelativePath.split(/[\\/]/)[0] === ".." ||
    isAbsolute(canonicalRelativePath)
  ) {
    throw new TypeError("The project public path must resolve inside the project directory");
  }
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
 * Copy safe regular files from the project public directory to build output.
 */
export async function copyStaticAssets(
  adapter: RuntimeAdapter,
  projectDir: string,
  outputDir: string,
  dryRun = false,
  reservedOutputPaths: Iterable<string> = [],
): Promise<AssetStats> {
  if (!projectDir.trim() || !outputDir.trim()) {
    throw new TypeError("projectDir and outputDir must not be blank");
  }
  const resolvedProjectDir = resolve(projectDir);
  const resolvedOutputDir = resolve(outputDir);
  const stats: AssetStats = { assets: 0, totalSize: 0 };
  const publicDir = join(resolvedProjectDir, "public");
  const outputFromPublic = relative(publicDir, resolvedOutputDir).replaceAll("\\", "/");
  if (outputFromPublic === "" || !outputFromPublic.startsWith("../")) {
    throw new TypeError("outputDir must not be inside the public directory");
  }

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
    throw new TypeError("The project public path must be a directory");
  }
  await assertCanonicalPublicDirectory(resolvedProjectDir, publicDir);

  const fs = createFileSystem();
  const normalizedReservedPaths = new Set(
    [...reservedOutputPaths].map((path) => {
      const normalized = path.replaceAll("\\", "/").replace(/^\.\//, "");
      if (
        !normalized || isAbsolute(path) || /^[A-Za-z]:\//.test(normalized) ||
        hasUnsafeControlCharacters(normalized) || normalized.includes("?") ||
        normalized.includes("#") || normalized.includes(":") ||
        normalized.split("/").some((segment) => !segment || segment === "." || segment === "..")
      ) {
        throw new TypeError("Reserved output paths must be safe relative paths");
      }
      return normalized;
    }),
  );

  const readFileBytes = async (path: string): Promise<Uint8Array> => {
    const buffer = await fs.readFile(path);
    return buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  };

  const writeFileBytes = async (path: string, data: Uint8Array): Promise<void> => {
    await fs.writeFile(path, data);
  };

  if (!dryRun) await ensureDirPath(resolvedOutputDir, adapter);

  for await (const entry of walk(publicDir, { followSymlinks: false, includeDirs: true })) {
    const relativePath = relative(publicDir, entry.path);
    if (
      !relativePath || relativePath === "." || relativePath === ".." ||
      relativePath.replaceAll("\\", "/").startsWith("../")
    ) continue;
    if (entry.isSymlink) continue;
    assertPublicOutputPath(relativePath, normalizedReservedPaths);

    const destinationPath = join(resolvedOutputDir, relativePath);

    if (entry.isDirectory) {
      if (!dryRun) await ensureDirPath(destinationPath, adapter);
      continue;
    }

    const fileInfo = await statPath(entry.path, adapter);
    if (!fileInfo.isFile || fileInfo.isSymlink) continue;
    if (!Number.isSafeInteger(fileInfo.size) || fileInfo.size < 0) {
      throw new TypeError("Static asset size must be a non-negative integer");
    }

    stats.assets += 1;
    stats.totalSize += fileInfo.size;

    if (dryRun) continue;

    await ensureDirPath(dirname(destinationPath), adapter);
    await writeFileBytes(destinationPath, await readFileBytes(entry.path));
  }

  logger.info(`Copied ${stats.assets} static assets`);
  return stats;
}

/**
 * Return the embedded baseline client stylesheet.
 */
export function loadClientStyles(): string {
  return CLIENT_STYLES;
}
