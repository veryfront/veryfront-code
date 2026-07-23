import { accessSync, constants, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ExistsOptions, WalkEntry, WalkOptions } from "./fs.ts";

type FsPath = string | URL;

function isMissingPathError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === "ENOENT" || code === "ENOTDIR";
}

function isUnreadablePathError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === "EACCES" || code === "EPERM" || isMissingPathError(error);
}

function validateTypeOptions(options?: ExistsOptions): void {
  if (options?.isDirectory && options.isFile) {
    throw new TypeError(
      "ExistsOptions.options.isDirectory and ExistsOptions.options.isFile must not be true together",
    );
  }
}

export async function ensureDir(dir: FsPath): Promise<void> {
  const { mkdir } = await import("node:fs/promises");
  await mkdir(dir, { recursive: true });
}

export function existsSync(path: FsPath, options?: ExistsOptions): boolean {
  try {
    const stats = statSync(path);
    validateTypeOptions(options);
    if (options?.isDirectory && !stats.isDirectory()) return false;
    if (options?.isFile && !stats.isFile()) return false;
    if (options?.isReadable) {
      try {
        accessSync(path, constants.R_OK);
      } catch (error) {
        if (isUnreadablePathError(error)) return false;
        throw error;
      }
    }
    return true;
  } catch (error) {
    if (isMissingPathError(error)) return false;
    throw error;
  }
}

export async function exists(
  path: FsPath,
  options?: ExistsOptions,
): Promise<boolean> {
  const { access, stat } = await import("node:fs/promises");
  try {
    const stats = await stat(path);
    validateTypeOptions(options);
    if (options?.isDirectory && !stats.isDirectory()) return false;
    if (options?.isFile && !stats.isFile()) return false;
    if (options?.isReadable) {
      try {
        await access(path, constants.R_OK);
      } catch (error) {
        if (isUnreadablePathError(error)) return false;
        throw error;
      }
    }
    return true;
  } catch (error) {
    if (isMissingPathError(error)) return false;
    throw error;
  }
}

function toPathString(path: FsPath): string {
  return typeof path === "string" ? path : fileURLToPath(path);
}

function stableRegExpTest(pattern: RegExp, value: string): boolean {
  const previousLastIndex = pattern.lastIndex;
  try {
    pattern.lastIndex = 0;
    return pattern.test(value);
  } finally {
    pattern.lastIndex = previousLastIndex;
  }
}

function includesPath(
  path: string,
  exts?: string[],
  match?: RegExp[],
  skip?: RegExp[],
): boolean {
  if (exts && !exts.some((ext) => path.endsWith(ext))) return false;
  if (match && !match.some((pattern) => stableRegExpTest(pattern, path))) return false;
  if (skip && skip.some((pattern) => stableRegExpTest(pattern, path))) return false;
  return true;
}

function compareNames(
  left: { name: string },
  right: { name: string },
): number {
  const leftName = String(left.name);
  const rightName = String(right.name);
  return leftName < rightName ? -1 : leftName > rightName ? 1 : 0;
}

export async function* walk(
  root: FsPath,
  options: WalkOptions = {},
): AsyncIterableIterator<WalkEntry> {
  const { lstat, readdir, realpath, stat } = await import("node:fs/promises");
  const { basename, join, normalize } = await import("node:path");

  let {
    maxDepth = Infinity,
    includeFiles = true,
    includeDirs = true,
    includeSymlinks = true,
    followSymlinks = false,
    canonicalize = true,
    exts,
    match,
    skip,
  } = options;

  if (maxDepth < 0) return;

  const rootPath = normalize(toPathString(root));
  if (exts) {
    exts = exts.map((ext) => ext.startsWith(".") ? ext : `.${ext}`);
  }

  const ancestorDirectories = new Set<string>();

  async function* walkPath(
    path: string,
    remainingDepth: number,
  ): AsyncIterableIterator<WalkEntry> {
    const pathStats = await stat(path);
    if (includeDirs && includesPath(path, exts, match, skip)) {
      yield {
        path,
        name: basename(path),
        isFile: pathStats.isFile(),
        isDirectory: pathStats.isDirectory(),
        isSymlink: pathStats.isSymbolicLink(),
      };
    }
    if (remainingDepth < 1 || !includesPath(path, undefined, undefined, skip)) return;

    const canonicalDirectory = await realpath(path);
    if (ancestorDirectories.has(canonicalDirectory)) return;
    ancestorDirectories.add(canonicalDirectory);

    try {
      const entries = await readdir(path, { withFileTypes: true });
      entries.sort(compareNames);

      for (const entry of entries) {
        const name = String(entry.name);
        let entryPath = join(path, name);

        if (entry.isSymbolicLink()) {
          if (!followSymlinks) {
            if (includeSymlinks && includesPath(entryPath, exts, match, skip)) {
              yield {
                path: entryPath,
                name,
                isFile: entry.isFile(),
                isDirectory: entry.isDirectory(),
                isSymlink: true,
              };
            }
            continue;
          }

          const realPath = await realpath(entryPath);
          if (canonicalize) entryPath = realPath;
          const targetStats = await lstat(realPath);
          if (targetStats.isSymbolicLink() || targetStats.isDirectory()) {
            yield* walkPath(entryPath, remainingDepth - 1);
            continue;
          }

          if (includeFiles && includesPath(entryPath, exts, match, skip)) {
            yield {
              path: entryPath,
              name,
              isFile: entry.isFile(),
              isDirectory: entry.isDirectory(),
              isSymlink: true,
            };
          }
          continue;
        }

        if (entry.isDirectory()) {
          yield* walkPath(entryPath, remainingDepth - 1);
        } else if (includeFiles && includesPath(entryPath, exts, match, skip)) {
          yield {
            path: entryPath,
            name,
            isFile: entry.isFile(),
            isDirectory: entry.isDirectory(),
            isSymlink: false,
          };
        }
      }
    } finally {
      ancestorDirectories.delete(canonicalDirectory);
    }
  }

  yield* walkPath(rootPath, maxDepth);
}
