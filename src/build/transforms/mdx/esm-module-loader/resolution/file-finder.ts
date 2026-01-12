/**
 * File Finder
 *
 * Resolves module paths to actual file paths using the adapter's file index
 * for fast extension resolution without API calls.
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
 * Decode file content to string.
 */
function decodeContent(content: string | Uint8Array): string {
  return typeof content === "string" ? content : new TextDecoder().decode(content);
}

/**
 * Try reading a file path and return the result or null.
 */
async function tryReadFile(
  path: string,
  readFile: (path: string) => Promise<string | Uint8Array>,
): Promise<FileResolutionResult | null> {
  try {
    const content = await readFile(path);
    return { sourceCode: decodeContent(content), actualFilePath: path };
  } catch {
    return null;
  }
}

/**
 * Resolve a module path to its actual file.
 * Uses the adapter's resolveFile() method which checks the in-memory file index
 * instead of making individual API calls for each extension.
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

  // Strip any existing extension before trying resolution
  const filePathWithoutExt = hasKnownExt
    ? filePathWithoutJs.replace(/\.(tsx|ts|jsx|js|mdx)$/, "")
    : filePathWithoutJs;

  // Use the adapter's resolveFile() method if available (uses in-memory file index)
  // This is MUCH faster than trying each extension via readFile API calls
  if (adapter.fs.resolveFile) {
    // Try each directory prefix with the index-based resolution
    for (const prefix of DIRECTORY_PREFIXES) {
      const basePath = prefix + filePathWithoutExt;
      const resolvedPath = await adapter.fs.resolveFile(basePath);

      if (resolvedPath) {
        try {
          const content = await adapter.fs.readFile(resolvedPath);
          logger.debug(`${LOG_PREFIX_MDX_LOADER} Found file via index`, {
            normalizedPath,
            basePath,
            resolvedPath,
          });
          return { sourceCode: decodeContent(content), actualFilePath: resolvedPath };
        } catch (error) {
          logger.warn(`${LOG_PREFIX_MDX_LOADER} Failed to read resolved file`, {
            resolvedPath,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    logger.debug(`${LOG_PREFIX_MDX_LOADER} Extension resolution failed via index`, {
      normalizedPath,
      filePathWithoutExt,
    });
  } else {
    // Fallback for adapters without resolveFile (e.g., local filesystem)
    // Try direct readFile for each extension
    const readFile = adapter.fs.readFile.bind(adapter.fs);

    for (const prefix of DIRECTORY_PREFIXES) {
      // If path has extension, try it directly first
      if (hasKnownExt) {
        const result = await tryReadFile(prefix + filePathWithoutJs, readFile);
        if (result) return result;
      }

      // Try each extension
      for (const ext of MODULE_EXTENSIONS) {
        const result = await tryReadFile(prefix + filePathWithoutExt + ext, readFile);
        if (result) return result;
      }

      // Try index file
      for (const ext of MODULE_EXTENSIONS) {
        const result = await tryReadFile(`${prefix}${filePathWithoutExt}/index${ext}`, readFile);
        if (result) return result;
      }
    }

    logger.debug(`${LOG_PREFIX_MDX_LOADER} Extension resolution failed (no resolveFile)`, {
      normalizedPath,
      filePathWithoutExt,
    });
  }

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
