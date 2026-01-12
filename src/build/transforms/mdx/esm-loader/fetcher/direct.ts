/**
 * Direct File Fetcher
 *
 * Fetches module source directly from the filesystem.
 *
 * @module build/transforms/mdx/esm-loader/fetcher/direct
 */

import { rendererLogger as logger } from "@veryfront/utils";
import { join } from "https://deno.land/std@0.220.0/path/mod.ts";
import { FRAMEWORK_ROOT, LOG_PREFIX_MDX_LOADER, SOURCE_EXTENSIONS } from "../constants.ts";
import { getLocalFs } from "../local-fs.ts";
import type { FSAdapter } from "../types.ts";
import {
  type ResolvedFile,
  resolveFileWithExtensions,
  resolveIndexFile,
  resolveWithStrippedPrefixes,
} from "./resolver.ts";

/**
 * Try to resolve a module source file.
 * Attempts multiple resolution strategies in order:
 * 1. Direct file with extensions
 * 2. Stripped prefixes
 * 3. Index files
 * 4. Framework lib fallback
 *
 * @param normalizedPath - The _vf_modules/ prefixed path
 * @param fs - Filesystem adapter
 * @returns Resolved file or null if not found
 */
export async function resolveModuleSource(
  normalizedPath: string,
  fs: FSAdapter,
): Promise<ResolvedFile | null> {
  // Extract file path from module path (remove _vf_modules/ prefix and .js)
  const filePathWithoutJs = normalizedPath
    .replace(/^_vf_modules\//, "")
    .replace(/\.js$/, "");

  // 1. Try direct file with extensions
  let result = await resolveFileWithExtensions(filePathWithoutJs, fs);
  if (result) return result;

  // 2. Try stripping common directory prefixes
  result = await resolveWithStrippedPrefixes(filePathWithoutJs, fs);
  if (result) return result;

  // 3. Try index files
  result = await resolveIndexFile(filePathWithoutJs, fs);
  if (result) return result;

  // 4. Fallback: For lib/* imports, check framework lib directory
  if (filePathWithoutJs.startsWith("lib/")) {
    const localFs = getLocalFs();
    for (const ext of SOURCE_EXTENSIONS) {
      const frameworkPath = join(FRAMEWORK_ROOT, filePathWithoutJs + ext);
      try {
        const stat = await localFs.stat(frameworkPath);
        if (stat?.isFile) {
          const content = await localFs.readTextFile(frameworkPath);
          logger.debug(`${LOG_PREFIX_MDX_LOADER} Found framework lib file (fallback)`, {
            basePath: filePathWithoutJs,
            resolvedPath: frameworkPath,
          });
          return { content, path: frameworkPath };
        }
      } catch {
        // Continue trying other extensions
      }
    }
  }

  return null;
}
