/**
 * File Resolver
 *
 * Utilities for finding source files and local lib files.
 *
 * @module rendering/orchestrator/file-resolver
 */

import { rendererLogger as logger } from "@veryfront/utils";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import { buildCandidatePaths, findFirstExisting } from "./candidates.ts";

// Re-export utilities
export { buildCandidatePaths, findFirstExisting } from "./candidates.ts";

/** Standard file extensions for source files */
const SOURCE_EXTENSIONS = [".tsx", ".ts", ".jsx", ".js", ".mdx", ".md"];
const COMPONENT_EXTENSIONS = [".tsx", ".ts", ".jsx", ".js"];

/**
 * Get the local lib directory path (veryfront-private/lib).
 * Determines the path relative to the current module.
 */
export function getLocalLibDir(): string {
  // This file is at src/rendering/orchestrator/file-resolver/index.ts
  // lib/ is at the root of veryfront-private
  const currentFile = new URL(import.meta.url).pathname;
  const srcIndex = currentFile.indexOf("/src/");
  if (srcIndex !== -1) {
    return currentFile.substring(0, srcIndex) + "/lib";
  }
  // Fallback: navigate up from current file location
  return currentFile.replace(/\/src\/rendering\/orchestrator\/file-resolver\/index\.ts$/, "/lib");
}

/**
 * Find local lib files (framework utilities in veryfront-private/lib).
 *
 * @param relativePath - Path relative to lib (e.g., "lib/Router" or "lib/usePageContext")
 * @param localAdapter - The local file system adapter
 * @returns The full path to the file or null if not found
 */
export async function findLocalLibFile(
  relativePath: string,
  localAdapter: RuntimeAdapter,
): Promise<string | null> {
  const libDir = getLocalLibDir();
  // relativePath is "lib/Router" or "lib/usePageContext" - strip "lib/" since we already have libDir
  const fileName = relativePath.replace(/^lib\//, "");
  const candidates = buildCandidatePaths(libDir, fileName, COMPONENT_EXTENSIONS);

  const result = await findFirstExisting(candidates, (p) => localAdapter.fs.stat(p));
  if (result) {
    logger.debug("[FileResolver] Found local lib file:", result);
  } else {
    logger.debug("[FileResolver] Local lib file not found:", relativePath);
  }
  return result;
}

/**
 * Find a source file in the project directory.
 *
 * @param basePath - Base path to search (e.g., "components/Button")
 * @param projectDir - The project directory
 * @param adapter - The runtime adapter
 * @returns The full path to the file or null if not found
 */
export async function findSourceFile(
  basePath: string,
  projectDir: string,
  adapter: RuntimeAdapter,
): Promise<string | null> {
  // Build candidates: Priority order: direct with ext > direct index > without components prefix
  const candidates = buildCandidatePaths(projectDir, basePath, SOURCE_EXTENSIONS);

  // Add variants without components/ prefix
  const withoutComponents = basePath.replace(/^components\//, "");
  if (withoutComponents !== basePath) {
    candidates.push(...buildCandidatePaths(projectDir, withoutComponents, SOURCE_EXTENSIONS));
  }

  const result = await findFirstExisting(candidates, (p) => adapter.fs.stat(p));
  if (result) {
    logger.debug("[FileResolver] Found file:", result);
  } else {
    logger.debug("[FileResolver] File not found:", basePath);
  }
  return result;
}
