/**
 * Portable subset of `@std/fs` for Deno, Node.js, and Bun.
 *
 * Deno uses the pinned standard-library implementation. Node.js and Bun use
 * the implementations below with matching failure and traversal semantics.
 *
 * @module
 */

import { isDeno } from "../runtime.ts";
import * as nodeFs from "node:fs";
import { fileURLToPath } from "node:url";

export interface WalkEntry {
  path: string;
  name: string;
  isFile: boolean;
  isDirectory: boolean;
  isSymlink: boolean;
}

export interface WalkOptions {
  maxDepth?: number;
  includeFiles?: boolean;
  includeDirs?: boolean;
  includeSymlinks?: boolean;
  followSymlinks?: boolean;
  canonicalize?: boolean;
  exts?: string[];
  match?: RegExp[];
  skip?: RegExp[];
}

export interface ExistsOptions {
  isReadable?: boolean;
  isDirectory?: boolean;
  isFile?: boolean;
}

type PathLike = string | URL;

async function nodeEnsureDir(directory: PathLike): Promise<void> {
  const { mkdir } = await import("node:fs/promises");
  // Recursive mkdir already succeeds for an existing directory and rejects an
  // existing non-directory. Do not suppress EEXIST: that distinction is the
  // contract callers rely on.
  await mkdir(directory, { recursive: true });
}

function validateExistsOptions(options: ExistsOptions | undefined): void {
  if (options?.isDirectory && options.isFile) {
    throw new TypeError(
      "ExistsOptions.isDirectory and ExistsOptions.isFile must not both be true",
    );
  }
}

function isMissingPathError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = Reflect.get(error, "code");
  return code === "ENOENT" || code === "ENOTDIR";
}

function isPermissionError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = Reflect.get(error, "code");
  return code === "EACCES" || code === "EPERM";
}

function nodeExistsSync(
  path: PathLike,
  options?: ExistsOptions,
): boolean {
  validateExistsOptions(options);

  try {
    const info = nodeFs.statSync(path);
    if (options?.isDirectory && !info.isDirectory()) return false;
    if (options?.isFile && !info.isFile()) return false;
    if (options?.isReadable) nodeFs.accessSync(path, nodeFs.constants.R_OK);
    return true;
  } catch (error) {
    if (isMissingPathError(error) || isPermissionError(error)) return false;
    throw error;
  }
}

async function nodeExists(
  path: PathLike,
  options?: ExistsOptions,
): Promise<boolean> {
  validateExistsOptions(options);
  const { access, stat } = await import("node:fs/promises");

  try {
    const info = await stat(path);
    if (options?.isDirectory && !info.isDirectory()) return false;
    if (options?.isFile && !info.isFile()) return false;
    if (options?.isReadable) await access(path, nodeFs.constants.R_OK);
    return true;
  } catch (error) {
    if (isMissingPathError(error) || isPermissionError(error)) return false;
    throw error;
  }
}

async function* nodeWalk(
  root: PathLike,
  options: WalkOptions = {},
): AsyncIterableIterator<WalkEntry> {
  const { lstat, readdir, realpath } = await import("node:fs/promises");
  const { basename, extname, join } = await import("node:path");
  const rootPath = pathToString(root);
  const maxDepth = options.maxDepth ?? Infinity;
  const includeFiles = options.includeFiles ?? true;
  const includeDirs = options.includeDirs ?? true;
  const includeSymlinks = options.includeSymlinks ?? true;
  const followSymlinks = options.followSymlinks ?? false;
  const canonicalize = options.canonicalize ?? true;
  const extensions = options.exts?.map((extension) =>
    extension.startsWith(".") ? extension : `.${extension}`
  );
  const visitedDirectories = new Set<string>();

  if (Number.isNaN(maxDepth)) {
    throw new RangeError("WalkOptions.maxDepth must not be NaN");
  }
  if (maxDepth < 0) return;

  const rootInfo = await lstat(rootPath);
  const rootEntry = toWalkEntry(rootPath, basename(rootPath), rootInfo);
  if (!rootEntry.isDirectory) {
    throw new TypeError(`Walk root is not a directory: ${rootPath}`);
  }

  const canonicalRoot = await realpath(rootPath);
  visitedDirectories.add(canonicalRoot);

  if (includeDirs && shouldInclude(rootPath, extensions, options.match, options.skip)) {
    yield rootEntry;
  }
  if (maxDepth < 1 || matchesAny(rootPath, options.skip)) return;

  yield* walkDirectory(rootPath, 1);

  async function* walkDirectory(
    directory: string,
    depth: number,
  ): AsyncIterableIterator<WalkEntry> {
    const entries = await readdir(directory, { withFileTypes: true });

    for (const dirEntry of entries) {
      const unresolvedPath = join(directory, String(dirEntry.name));
      if (matchesAny(unresolvedPath, options.skip)) continue;

      let outputPath = unresolvedPath;
      let isFile = dirEntry.isFile();
      let isDirectory = dirEntry.isDirectory();
      const isSymlink = dirEntry.isSymbolicLink();
      let canonicalDirectory: string | null = null;

      if (isSymlink && followSymlinks) {
        const resolvedPath = await realpath(unresolvedPath);
        const targetInfo = await lstat(resolvedPath);
        isFile = targetInfo.isFile();
        isDirectory = targetInfo.isDirectory();
        canonicalDirectory = isDirectory ? resolvedPath : null;
        if (canonicalize) outputPath = resolvedPath;
      }

      const entry: WalkEntry = {
        path: outputPath,
        name: String(dirEntry.name),
        isFile,
        isDirectory,
        isSymlink,
      };

      if (isSymlink && !followSymlinks) {
        if (
          includeSymlinks &&
          shouldInclude(outputPath, extensions, options.match, options.skip)
        ) {
          yield entry;
        }
        continue;
      }

      if (isDirectory) {
        if (
          includeDirs &&
          shouldInclude(outputPath, extensions, options.match, options.skip)
        ) {
          yield entry;
        }
        if (depth >= maxDepth) continue;

        canonicalDirectory ??= await realpath(unresolvedPath);
        if (visitedDirectories.has(canonicalDirectory)) continue;
        visitedDirectories.add(canonicalDirectory);
        const traversalPath = isSymlink && canonicalize ? outputPath : unresolvedPath;
        yield* walkDirectory(traversalPath, depth + 1);
        continue;
      }

      if (
        isFile &&
        includeFiles &&
        shouldInclude(outputPath, extensions, options.match, options.skip)
      ) {
        yield entry;
      }
    }
  }

  function shouldInclude(
    path: string,
    acceptedExtensions: readonly string[] | undefined,
    match: readonly RegExp[] | undefined,
    skip: readonly RegExp[] | undefined,
  ): boolean {
    if (
      acceptedExtensions &&
      !acceptedExtensions.some((extension) =>
        path.endsWith(extension) || extname(path) === extension
      )
    ) {
      return false;
    }
    if (match && !matchesAny(path, match)) return false;
    return !matchesAny(path, skip);
  }
}

function matchesAny(
  value: string,
  patterns: readonly RegExp[] | undefined,
): boolean {
  if (!patterns) return false;
  return patterns.some((pattern) => {
    pattern.lastIndex = 0;
    const matches = pattern.test(value);
    pattern.lastIndex = 0;
    return matches;
  });
}

function toWalkEntry(
  path: string,
  name: string,
  info: {
    isFile(): boolean;
    isDirectory(): boolean;
    isSymbolicLink(): boolean;
  },
): WalkEntry {
  return {
    path,
    name,
    isFile: info.isFile(),
    isDirectory: info.isDirectory(),
    isSymlink: info.isSymbolicLink(),
  };
}

function pathToString(path: PathLike): string {
  if (typeof path === "string") return path;
  if (path.protocol !== "file:") {
    throw new TypeError(`Expected a file URL, received ${path.protocol}`);
  }
  return fileURLToPath(path);
}

export let ensureDir: (directory: PathLike) => Promise<void>;
export let exists: (
  path: PathLike,
  options?: ExistsOptions,
) => Promise<boolean>;
export let existsSync: (
  path: PathLike,
  options?: ExistsOptions,
) => boolean;
export let walk: (
  root: PathLike,
  options?: WalkOptions,
) => AsyncIterableIterator<WalkEntry>;

if (isDeno) {
  const stdFs = await import("#std/fs.ts");
  ensureDir = stdFs.ensureDir;
  exists = stdFs.exists;
  existsSync = stdFs.existsSync;
  walk = stdFs.walk;
} else {
  ensureDir = nodeEnsureDir;
  exists = nodeExists;
  existsSync = nodeExistsSync;
  walk = nodeWalk;
}
