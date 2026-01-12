/**
 * Local Filesystem Access
 *
 * Provides access to the local filesystem for cache operations.
 * Uses the platform's native fs (Deno, Node, Bun) for local cache writes,
 * not the project's FSAdapter which may be remote/read-only.
 *
 * @module build/transforms/mdx/esm-loader/local-fs
 */

import { createFileSystem, type FileSystem } from "@veryfront/platform/compat/fs.ts";

/** Cached local filesystem instance */
let _localFs: FileSystem | null = null;

/**
 * Get the local filesystem for cache operations.
 */
export function getLocalFs(): FileSystem {
  if (!_localFs) {
    _localFs = createFileSystem();
  }
  return _localFs;
}
