import * as fs from "node:fs/promises";
import { accessSync } from "node:fs";
import * as nodePath from "node:path";

export async function exists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch (_) {
    /* expected: access fails when path does not exist */
    return false;
  }
}

export function existsSync(path: string): boolean {
  try {
    accessSync(path);
    return true;
  } catch (_) {
    /* expected: access fails when path does not exist */
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
  const maxDepth = options.maxDepth ?? Infinity;
  const includeFiles = options.includeFiles ?? true;
  const includeDirs = options.includeDirs ?? true;
  const { exts, skip } = options;

  async function* walkDir(
    dir: string,
    depth: number,
  ): AsyncGenerator<WalkEntry> {
    if (depth > maxDepth) return;

    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const path = nodePath.join(dir, entry.name);

      if (skip?.some((pattern) => pattern.test(path))) continue;

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
        continue;
      }

      if (!includeFiles || !entry.isFile()) continue;

      if (exts) {
        const ext = nodePath.extname(path).slice(1);
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
