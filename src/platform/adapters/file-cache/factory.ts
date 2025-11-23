import { FileCache } from "./file-cache.ts";
import type { FileCacheOptions } from "./types.ts";

export function createFileCache(options?: FileCacheOptions): FileCache {
  return new FileCache(options);
}
