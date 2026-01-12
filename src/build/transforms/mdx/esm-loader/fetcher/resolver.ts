/**
 * Module Path Resolver
 *
 * Utilities for resolving module paths with extension fallbacks.
 *
 * @module build/transforms/mdx/esm-loader/fetcher/resolver
 */

import { rendererLogger as logger } from "@veryfront/utils";
import { posix } from "https://deno.land/std@0.220.0/path/mod.ts";
import {
  DIRECTORY_PREFIXES,
  LOG_PREFIX_MDX_LOADER,
  PREFIXES_TO_STRIP,
  SOURCE_EXTENSIONS,
} from "../constants.ts";
import type { FSAdapter } from "../types.ts";

export interface ResolvedFile {
  content: string;
  path: string;
}

/**
 * Normalize a module path, resolving relative paths if parent is provided.
 */
export function normalizeModulePath(
  modulePath: string,
  parentModulePath?: string,
): string {
  // Remove leading slash
  let normalizedPath = modulePath.replace(/^\//, "");

  // If it's a relative import and we have a parent, resolve it relative to parent
  if (parentModulePath && (modulePath.startsWith("./") || modulePath.startsWith("../"))) {
    const parentDir = parentModulePath.replace(/\/[^/]+$/, "");
    const joinedPath = posix.join(parentDir, modulePath);
    normalizedPath = posix.normalize(joinedPath);

    // Ensure it has _vf_modules prefix
    if (!normalizedPath.startsWith("_vf_modules/")) {
      normalizedPath = `_vf_modules/${normalizedPath}`;
    }
  }

  return normalizedPath;
}

/**
 * Try to resolve a file with extension fallbacks.
 * Returns the file content and resolved path if found.
 */
export async function resolveFileWithExtensions(
  basePath: string,
  fs: FSAdapter,
): Promise<ResolvedFile | null> {
  // Check if path already has a known extension
  const hasKnownExt = SOURCE_EXTENSIONS.some((ext) => basePath.endsWith(ext));

  // If path already has extension, try it directly first
  if (hasKnownExt) {
    for (const prefix of DIRECTORY_PREFIXES) {
      const tryPath = prefix + basePath;
      try {
        const content = await fs.readFile(tryPath);
        return {
          content: typeof content === "string" ? content : new TextDecoder().decode(content),
          path: tryPath,
        };
      } catch {
        // Try next prefix
      }
    }
  }

  // Strip any existing extension before adding new ones
  const pathWithoutExt = hasKnownExt ? basePath.replace(/\.(tsx|ts|jsx|js|mdx)$/, "") : basePath;

  const triedPaths: string[] = [];

  // Try adding extensions
  for (const prefix of DIRECTORY_PREFIXES) {
    for (const ext of SOURCE_EXTENSIONS) {
      const tryPath = prefix + pathWithoutExt + ext;
      triedPaths.push(tryPath);
      try {
        const content = await fs.readFile(tryPath);
        logger.debug(`${LOG_PREFIX_MDX_LOADER} Found file with extension`, {
          basePath,
          tryPath,
        });
        return {
          content: typeof content === "string" ? content : new TextDecoder().decode(content),
          path: tryPath,
        };
      } catch {
        // Try next extension
      }
    }
  }

  logger.debug(`${LOG_PREFIX_MDX_LOADER} Extension resolution failed`, {
    basePath,
    pathWithoutExt,
    triedPaths,
  });

  return null;
}

/**
 * Try to resolve a file by stripping common directory prefixes.
 * Handles cases where API stores files at root level but code imports them with prefixes.
 */
export async function resolveWithStrippedPrefixes(
  basePath: string,
  fs: FSAdapter,
): Promise<ResolvedFile | null> {
  const hasKnownExt = SOURCE_EXTENSIONS.some((ext) => basePath.endsWith(ext));
  const pathWithoutExt = hasKnownExt ? basePath.replace(/\.(tsx|ts|jsx|js|mdx)$/, "") : basePath;

  for (const stripPrefix of PREFIXES_TO_STRIP) {
    if (pathWithoutExt.startsWith(stripPrefix)) {
      const strippedPath = pathWithoutExt.slice(stripPrefix.length);
      for (const ext of SOURCE_EXTENSIONS) {
        const tryPath = strippedPath + ext;
        try {
          const content = await fs.readFile(tryPath);
          logger.debug(`${LOG_PREFIX_MDX_LOADER} Found file after stripping prefix`, {
            originalPath: basePath,
            strippedPath: tryPath,
          });
          return {
            content: typeof content === "string" ? content : new TextDecoder().decode(content),
            path: tryPath,
          };
        } catch {
          // Try next extension
        }
      }
    }
  }

  return null;
}

/**
 * Try to resolve index files in a directory.
 */
export async function resolveIndexFile(
  basePath: string,
  fs: FSAdapter,
): Promise<ResolvedFile | null> {
  const hasKnownExt = SOURCE_EXTENSIONS.some((ext) => basePath.endsWith(ext));
  const pathForIndex = hasKnownExt ? basePath.replace(/\.(tsx|ts|jsx|js|mdx)$/, "") : basePath;

  for (const prefix of DIRECTORY_PREFIXES) {
    for (const ext of SOURCE_EXTENSIONS) {
      const tryPath = `${prefix}${pathForIndex}/index${ext}`;
      try {
        const content = await fs.readFile(tryPath);
        return {
          content: typeof content === "string" ? content : new TextDecoder().decode(content),
          path: tryPath,
        };
      } catch {
        // Try next extension
      }
    }
  }

  return null;
}
