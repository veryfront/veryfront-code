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

// ============================================================================
// Types
// ============================================================================

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

// ============================================================================
// Node.js/Bun implementation
// ============================================================================

async function nodeEnsureDir(dir: string): Promise<void> {
  const { mkdir } = await import("node:fs/promises");
  try {
    await mkdir(dir, { recursive: true });
  } catch (err) {
    // Ignore if already exists
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") {
      throw err;
    }
  }
}

function nodeExistsSync(path: string): boolean {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

async function nodeExists(path: string): Promise<boolean> {
  try {
    const { stat } = await import("node:fs/promises");
    await stat(path);
    return true;
  } catch {
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

  async function* walkDir(dir: string, depth: number): AsyncIterableIterator<WalkEntry> {
    if (depth > maxDepth) return;

    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const path = join(dir, entry.name);

      // Check skip patterns
      if (skip?.some((pattern) => pattern.test(path))) {
        continue;
      }

      const isSymlink = entry.isSymbolicLink();
      let isFile = entry.isFile();
      let isDirectory = entry.isDirectory();

      // Follow symlinks if requested
      if (isSymlink && followSymlinks) {
        try {
          const stats = await stat(path);
          isFile = stats.isFile();
          isDirectory = stats.isDirectory();
        } catch {
          continue; // Skip broken symlinks
        }
      }

      // Check extension filter - exts includes the leading dot (e.g., [".css"])
      if (exts && isFile) {
        const ext = extname(entry.name); // extname returns ".css" including the dot
        if (!exts.includes(ext)) continue;
      }

      // Check match patterns
      if (match && !match.some((pattern) => pattern.test(path))) {
        continue;
      }

      const walkEntry: WalkEntry = {
        path,
        name: entry.name,
        isFile,
        isDirectory,
        isSymlink,
      };

      // Yield based on type
      if (isFile && includeFiles) {
        yield walkEntry;
      } else if (isDirectory && includeDirs) {
        yield walkEntry;
      } else if (isSymlink && includeSymlinks && !followSymlinks) {
        yield walkEntry;
      }

      // Recurse into directories
      if (isDirectory) {
        yield* walkDir(path, depth + 1);
      }
    }
  }

  yield* walkDir(root, 0);
}

// ============================================================================
// Exports
// ============================================================================

export let ensureDir: (dir: string) => Promise<void>;
export let exists: (path: string) => Promise<boolean>;
export let existsSync: (path: string) => boolean;
export let walk: (root: string, options?: WalkOptions) => AsyncIterableIterator<WalkEntry>;

if (isDeno) {
  // Deno: Use @std/fs
  const stdFs = await import("#std/fs.ts");
  ensureDir = stdFs.ensureDir;
  exists = stdFs.exists;
  existsSync = stdFs.existsSync;
  walk = stdFs.walk;
} else {
  // Node.js/Bun: Use our implementations
  ensureDir = nodeEnsureDir;
  exists = nodeExists;
  existsSync = nodeExistsSync;
  walk = nodeWalk;
}
