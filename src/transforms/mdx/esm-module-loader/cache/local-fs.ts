import { createFileSystem, type FileSystem } from "#veryfront/platform/compat/fs.ts";

// Local filesystem for cache operations (not project's FSAdapter which may be remote/read-only).
// This uses the platform's native fs for local cache writes.
let localFs: FileSystem | null = null;

export function getLocalFs(): FileSystem {
  localFs ??= createFileSystem();
  return localFs;
}
