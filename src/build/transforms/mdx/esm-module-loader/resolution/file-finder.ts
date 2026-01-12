/**
 * File Finder
 *
 * Resolves module paths to actual file paths by trying various extensions
 * and directory prefixes.
 *
 * @module build/transforms/mdx/esm-module-loader/resolution/file-finder
 */

import { join } from "https://deno.land/std@0.220.0/path/mod.ts";
import { rendererLogger as logger } from "@veryfront/utils";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import {
  DIRECTORY_PREFIXES,
  FRAMEWORK_ROOT,
  LOG_PREFIX_MDX_LOADER,
  MODULE_EXTENSIONS,
  PREFIXES_TO_STRIP,
} from "../constants.ts";
import { getLocalFs } from "../cache/index.ts";

/**
 * Result of file resolution.
 */
export interface FileResolutionResult {
  /** The source code content */
  sourceCode: string;
  /** The actual file path that was resolved */
  actualFilePath: string;
}

/**
 * Try to read a file from the adapter's filesystem.
 * Returns the content as a string if successful, null otherwise.
 */
async function tryReadFile(
  adapter: RuntimeAdapter,
  path: string,
): Promise<string | null> {
  try {
    const content = await adapter.fs.readFile(path);
    return typeof content === "string" ? content : new TextDecoder().decode(content as Uint8Array);
  } catch {
    return null;
  }
}

/**
 * Build all candidate paths for a module.
 * Returns paths in priority order (first match wins).
 */
function buildCandidatePaths(
  filePathWithoutExt: string,
  filePathWithoutJs: string,
  hasKnownExt: boolean,
): string[] {
  const candidates: string[] = [];

  // If path already has extension, try it directly first
  if (hasKnownExt) {
    for (const prefix of DIRECTORY_PREFIXES) {
      candidates.push(prefix + filePathWithoutJs);
    }
  }

  // Try with different extensions
  for (const prefix of DIRECTORY_PREFIXES) {
    for (const ext of MODULE_EXTENSIONS) {
      candidates.push(prefix + filePathWithoutExt + ext);
    }
  }

  // Try stripping common directory prefixes
  for (const stripPrefix of PREFIXES_TO_STRIP) {
    if (filePathWithoutExt.startsWith(stripPrefix)) {
      const strippedPath = filePathWithoutExt.slice(stripPrefix.length);
      for (const ext of MODULE_EXTENSIONS) {
        candidates.push(strippedPath + ext);
      }
    }
  }

  // Try index files
  const basePath = hasKnownExt
    ? filePathWithoutJs.replace(/\.(tsx|ts|jsx|js|mdx)$/, "")
    : filePathWithoutJs;

  for (const prefix of DIRECTORY_PREFIXES) {
    for (const ext of MODULE_EXTENSIONS) {
      candidates.push(`${prefix}${basePath}/index${ext}`);
    }
  }

  return candidates;
}

/**
 * Resolve a module path to its actual file.
 * Optimized to check candidates in parallel batches.
 *
 * @param normalizedPath - The normalized module path (e.g., "_vf_modules/components/Button")
 * @param adapter - The runtime adapter for file operations
 * @returns The file content and actual path, or null if not found
 */
export async function resolveModuleFile(
  normalizedPath: string,
  adapter: RuntimeAdapter,
): Promise<FileResolutionResult | null> {
  // Extract file path from module path (remove _vf_modules/ prefix)
  const filePathWithoutJs = normalizedPath
    .replace(/^_vf_modules\//, "")
    .replace(/\.js$/, "");

  // Check if path already has a known extension
  const hasKnownExt = MODULE_EXTENSIONS.some((ext) => filePathWithoutJs.endsWith(ext));

  // Strip any existing extension before adding new ones
  const filePathWithoutExt = hasKnownExt
    ? filePathWithoutJs.replace(/\.(tsx|ts|jsx|js|mdx)$/, "")
    : filePathWithoutJs;

  // Build all candidate paths in priority order
  const candidates = buildCandidatePaths(filePathWithoutExt, filePathWithoutJs, hasKnownExt);

  // Try candidates in parallel batches (to avoid overwhelming the API)
  // Process in batches of 6 (one batch per extension type)
  const BATCH_SIZE = 6;

  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    const batch = candidates.slice(i, i + BATCH_SIZE);

    // Try batch in parallel
    const results = await Promise.all(
      batch.map(async (tryPath) => {
        const content = await tryReadFile(adapter, tryPath);
        return content !== null ? { content, path: tryPath } : null;
      }),
    );

    // Return first successful result (maintains priority order within batch)
    const found = results.find((r) => r !== null);
    if (found) {
      logger.debug(`${LOG_PREFIX_MDX_LOADER} Found file`, {
        normalizedPath,
        resolvedPath: found.path,
      });
      return { sourceCode: found.content, actualFilePath: found.path };
    }
  }

  logger.debug(`${LOG_PREFIX_MDX_LOADER} Extension resolution failed`, {
    normalizedPath,
    filePathWithoutExt,
    candidateCount: candidates.length,
  });

  // FALLBACK: For lib/* imports not found in project, check framework lib directory
  // This provides framework utilities like lib/Router, lib/Head, lib/usePageContext
  if (filePathWithoutJs.startsWith("lib/")) {
    const localFs = getLocalFs();
    for (const ext of MODULE_EXTENSIONS) {
      const frameworkPath = join(FRAMEWORK_ROOT, filePathWithoutJs + ext);
      try {
        const stat = await localFs.stat(frameworkPath);
        if (stat?.isFile) {
          const content = await localFs.readTextFile(frameworkPath);
          logger.debug(`${LOG_PREFIX_MDX_LOADER} Found framework lib file (fallback)`, {
            basePath: filePathWithoutJs,
            resolvedPath: frameworkPath,
          });
          return { sourceCode: content, actualFilePath: frameworkPath };
        }
      } catch {
        // Continue trying other extensions
      }
    }
  }

  return null;
}

/**
 * Resolve a file path with extension.
 * Used for @/ alias and /_vf_modules/ import transforms.
 *
 * @param relativePath - The path relative to the project root
 * @param readFile - Function to read file content
 * @returns The file content, resolved path, and extension, or null if not found
 */
export async function resolveFileWithExtension(
  relativePath: string,
  readFile: (path: string) => Promise<string | null>,
): Promise<{ content: string; resolvedPath: string; extension: string } | null> {
  // Try common extensions
  const extensions = ["", ".tsx", ".ts", ".jsx", ".js", ".mdx"];

  for (const tryExt of extensions) {
    const tryPath = relativePath + tryExt;
    const content = await readFile(tryPath);
    if (content !== null) {
      const ext = tryExt || tryPath.split(".").pop() || "";
      return { content, resolvedPath: tryPath, extension: ext };
    }
  }

  // Also try index files
  for (const tryExt of [".tsx", ".ts", ".jsx", ".js", ".mdx"]) {
    const tryPath = `${relativePath}/index${tryExt}`;
    const content = await readFile(tryPath);
    if (content !== null) {
      return { content, resolvedPath: tryPath, extension: tryExt };
    }
  }

  return null;
}
