/**
 * Portable @std/fs shim for Node.js and Bun.
 *
 * In Deno: Uses @std/fs
 * In Node.js/Bun: Provides compatible implementations using node:fs
 *
 * @module
 */

import { isDeno } from "../runtime.ts";

export interface ExistsOptions {
  isReadable?: boolean;
  isDirectory?: boolean;
  isFile?: boolean;
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
  includeSymlinks?: boolean;
  followSymlinks?: boolean;
  canonicalize?: boolean;
  exts?: string[];
  match?: RegExp[];
  skip?: RegExp[];
}

export let ensureDir: (dir: string | URL) => Promise<void>;
export let exists: (
  path: string | URL,
  options?: ExistsOptions,
) => Promise<boolean>;
export let existsSync: (
  path: string | URL,
  options?: ExistsOptions,
) => boolean;
export let walk: (
  root: string | URL,
  options?: WalkOptions,
) => AsyncIterableIterator<WalkEntry>;

if (isDeno) {
  const stdFs = await import("#std/fs.ts");
  ensureDir = stdFs.ensureDir;
  exists = stdFs.exists;
  existsSync = stdFs.existsSync;
  walk = stdFs.walk;
} else {
  const nodeFs = await import("./fs-node.ts");
  ensureDir = nodeFs.ensureDir;
  exists = nodeFs.exists;
  existsSync = nodeFs.existsSync;
  walk = nodeFs.walk;
}
