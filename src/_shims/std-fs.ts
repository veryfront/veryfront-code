import * as fs from "node:fs/promises";
import { accessSync } from "node:fs";
import * as nodePath from "node:path";

export async function exists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

export function existsSync(path: string): boolean {
  try {
    accessSync(path);
    return true;
  } catch {
    return false;
  }
}

export async function ensureDir(path: string): Promise<void> {
  await fs.mkdir(path, { recursive: true });
}

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
      const fullPath = nodePath.join(dir, entry.name);

      if (skip && skip.some((pattern: RegExp) => pattern.test(fullPath))) continue;

      const isSymlink = entry.isSymbolicLink();

      if (entry.isDirectory()) {
        if (includeDirs) {
          yield {
            path: fullPath,
            name: entry.name,
            isFile: false,
            isDirectory: true,
            isSymlink,
          };
        }
        yield* walkDir(fullPath, depth + 1);
      } else if (entry.isFile() && includeFiles) {
        if (exts) {
          // Use nodePath.extname for proper extension extraction
          const ext = nodePath.extname(entry.name).slice(1); // Remove leading dot
          if (!ext || !exts.includes(ext)) continue;
        }
        yield {
          path: fullPath,
          name: entry.name,
          isFile: true,
          isDirectory: false,
          isSymlink,
        };
      }
    }
  }

  yield* walkDir(root, 0);
}

export const readFile = fs.readFile;
export const writeFile = fs.writeFile;
export const mkdir = fs.mkdir;
export const readdir = fs.readdir;
export const rm = fs.rm;
export const unlink = fs.unlink;
export const stat = fs.stat;
export const access = fs.access;
