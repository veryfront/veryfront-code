/**
 * Cross-platform shim for Deno std/fs module
 * Provides Node.js-compatible implementations of Deno std/fs functions
 */

import * as fs from "node:fs/promises";
import { accessSync } from "node:fs";
import * as nodePath from "node:path";

/**
 * Check if a file or directory exists
 */
export async function exists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Synchronous version of exists (uses require for sync access)
 */
export function existsSync(path: string): boolean {
  try {
    accessSync(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Ensure directory exists, creating it if necessary
 */
export async function ensureDir(path: string): Promise<void> {
  await fs.mkdir(path, { recursive: true });
}

/**
 * Walk entry type matching Deno's std/fs/walk
 */
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
  exts?: string[];
  skip?: RegExp[];
}

/**
 * Walk directory recursively
 */
export async function* walk(
  root: string,
  options: WalkOptions = {},
): AsyncGenerator<WalkEntry> {
  const {
    maxDepth = Infinity,
    includeFiles = true,
    includeDirs = true,
    exts,
    skip,
  } = options;

  async function* walkDir(
    dir: string,
    depth: number,
  ): AsyncGenerator<WalkEntry> {
    if (depth > maxDepth) return;

    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const path = nodePath.join(dir, entry.name);

      // Check skip patterns
      if (skip && skip.some((pattern: RegExp) => pattern.test(path))) continue;

      if (entry.isDirectory()) {
        if (includeDirs) {
          yield {
            path,
            name: entry.name,
            isFile: false,
            isDirectory: true,
            isSymlink: false,
          };
        }
        yield* walkDir(path, depth + 1);
      } else if (entry.isFile() && includeFiles) {
        // Check extension filter
        if (exts) {
          const ext = path.split(".").pop();
          if (!ext || !exts.includes(ext)) continue;
        }
        yield {
          path,
          name: entry.name,
          isFile: true,
          isDirectory: false,
          isSymlink: false,
        };
      }
    }
  }

  yield* walkDir(root, 0);
}

// Re-export node:fs/promises functions for direct use
export const readFile = fs.readFile;
export const writeFile = fs.writeFile;
export const mkdir = fs.mkdir;
export const readdir = fs.readdir;
export const rm = fs.rm;
export const unlink = fs.unlink;
export const stat = fs.stat;
export const access = fs.access;
