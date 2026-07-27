import * as fs from "node:fs/promises";
import { accessSync } from "node:fs";
import * as nodePath from "node:path";
import { isNotFoundError } from "../fs.ts";

export async function exists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch (error) {
    if (isNotFoundError(error)) return false;
    throw error;
  }
}

export function existsSync(path: string): boolean {
  try {
    accessSync(path);
    return true;
  } catch (error) {
    if (isNotFoundError(error)) return false;
    throw error;
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

function matchesPattern(pattern: RegExp, value: string): boolean {
  const previousLastIndex = pattern.lastIndex;
  pattern.lastIndex = 0;
  try {
    return pattern.test(value);
  } finally {
    pattern.lastIndex = previousLastIndex;
  }
}

export async function* walk(
  root: string,
  options: WalkOptions = {},
): AsyncGenerator<WalkEntry> {
  const maxDepth = options.maxDepth ?? Infinity;
  if (
    maxDepth !== Infinity &&
    (!Number.isInteger(maxDepth) || maxDepth < 0)
  ) {
    throw new RangeError("walk maxDepth must be a non-negative integer or Infinity");
  }

  const includeFiles = options.includeFiles ?? true;
  const includeDirs = options.includeDirs ?? true;
  const { exts, skip } = options;
  const allowedExtensions = exts?.map((ext) => ext.startsWith(".") ? ext.slice(1) : ext);

  async function* walkDir(
    dir: string,
    depth: number,
  ): AsyncGenerator<WalkEntry> {
    if (depth > maxDepth) return;

    const entries = await fs.readdir(dir, { withFileTypes: true });
    entries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);

    for (const entry of entries) {
      const path = nodePath.join(dir, entry.name);

      if (skip?.some((pattern) => matchesPattern(pattern, path))) continue;

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

      if (allowedExtensions) {
        const ext = nodePath.extname(path).slice(1);
        if (!ext || !allowedExtensions.includes(ext)) continue;
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
