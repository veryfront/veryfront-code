/**
 * Portable @std/fs shim for Node.js and Bun.
 *
 * In Deno: Uses @std/fs
 * In Node.js/Bun: Provides compatible implementations using node:fs
 *
 * @module
 */

import { statSync } from "node:fs";
import { isDeno } from "../runtime.ts";

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
  exts?: string[];
  match?: RegExp[];
  skip?: RegExp[];
}

async function nodeEnsureDir(dir: string): Promise<void> {
  const { mkdir } = await import("node:fs/promises");
  try {
    await mkdir(dir, { recursive: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
}

function nodeExistsSync(path: string): boolean {
  try {
    statSync(path);
    return true;
  } catch (_) {
    /* expected: stat fails when path does not exist */
    return false;
  }
}

async function nodeExists(path: string): Promise<boolean> {
  const { stat } = await import("node:fs/promises");
  try {
    await stat(path);
    return true;
  } catch (_) {
    /* expected: stat fails when path does not exist */
    return false;
  }
}

async function* nodeWalk(
  root: string,
  options: WalkOptions = {},
): AsyncIterableIterator<WalkEntry> {
  const { readdir, stat } = await import("node:fs/promises");
  const { join, extname } = await import("node:path");

  const {
    maxDepth = Infinity,
    includeFiles = true,
    includeDirs = true,
    includeSymlinks = true,
    followSymlinks = false,
    exts,
    match,
    skip,
  } = options;

  async function* walkDir(
    dir: string,
    depth: number,
  ): AsyncIterableIterator<WalkEntry> {
    if (depth > maxDepth) return;

    let entries: Array<{
      name: string;
      isFile: () => boolean;
      isDirectory: () => boolean;
      isSymbolicLink: () => boolean;
    }>;

    try {
      entries = (await readdir(dir, { withFileTypes: true })).map((e) => ({
        name: String(e.name),
        isFile: () => e.isFile(),
        isDirectory: () => e.isDirectory(),
        isSymbolicLink: () => e.isSymbolicLink(),
      }));
    } catch (_) {
      /* expected: readdir may fail on inaccessible directories */
      return;
    }

    for (const entry of entries) {
      const name = entry.name;
      const path = join(dir, name);

      if (skip?.some((pattern) => pattern.test(path))) continue;

      const isSymlink = entry.isSymbolicLink();
      let isFile = entry.isFile();
      let isDirectory = entry.isDirectory();

      if (isSymlink && followSymlinks) {
        try {
          const stats = await stat(path);
          isFile = stats.isFile();
          isDirectory = stats.isDirectory();
        } catch (_) {
          /* expected: symlink target may not exist */
          continue;
        }
      }

      if (isFile && exts && !exts.includes(extname(name))) continue;
      if (match && !match.some((pattern) => pattern.test(path))) continue;

      const walkEntry: WalkEntry = {
        path,
        name,
        isFile,
        isDirectory,
        isSymlink,
      };

      if (isFile) {
        if (includeFiles) yield walkEntry;
      } else if (isDirectory) {
        if (includeDirs) yield walkEntry;
      } else if (isSymlink && includeSymlinks && !followSymlinks) {
        yield walkEntry;
      }

      if (isDirectory) yield* walkDir(path, depth + 1);
    }
  }

  yield* walkDir(root, 0);
}

export let ensureDir: (dir: string) => Promise<void>;
export let exists: (path: string) => Promise<boolean>;
export let existsSync: (path: string) => boolean;
export let walk: (
  root: string,
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
