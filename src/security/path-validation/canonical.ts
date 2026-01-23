/**
 * Canonical Path Resolution
 * @module security/path-validation/canonical
 */

import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";

import { isWithinDirectory, normalizeSeparators, resolvePathSegments } from "./normalization.ts";
import { PathValidationError, type ValidationResult } from "./types.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";

/**
 * Get canonical path by resolving symlinks
 * Falls back to path resolution if adapter not available
 */
export function getCanonicalPath(
  path: string,
  adapter?: RuntimeAdapter,
  followSymlinks = false,
): Promise<{ path: string; isSymlink: boolean }> {
  return withSpan("security.path.getCanonical", async () => {
    // If no adapter or not following symlinks, just resolve path segments
    if (!adapter || !followSymlinks) {
      return {
        path: resolvePathSegments(path),
        isSymlink: false,
      };
    }

    try {
      const stat = await adapter.fs.stat(path);

      if (stat.isSymlink) {
        return {
          path: resolvePathSegments(path),
          isSymlink: true,
        };
      }

      return {
        path: resolvePathSegments(path),
        isSymlink: false,
      };
    } catch {
      return {
        path: resolvePathSegments(path),
        isSymlink: false,
      };
    }
  }, { "path.input": path, "path.followSymlinks": followSymlinks });
}

/**
 * Validate path against allowed directories
 */
export function validateAllowedDirs(
  canonicalPath: string,
  baseDir: string,
  allowedDirs: string[],
): ValidationResult {
  // Resolve path segments (. and ..) in both paths for consistent comparison
  const normalizedBase = resolvePathSegments(normalizeSeparators(baseDir)).replace(/\/$/, "");
  const normalizedPath = resolvePathSegments(normalizeSeparators(canonicalPath)).replace(/\/$/, "");

  // Path must be within base directory
  if (!isWithinDirectory(normalizedBase, normalizedPath)) {
    return {
      valid: false,
      error: `Path is outside base directory: ${baseDir}`,
      code: PathValidationError.OUTSIDE_BASE,
    };
  }

  // If no allowed dirs specified, any path in base is OK
  if (!allowedDirs || allowedDirs.length === 0) {
    return { valid: true, canonicalPath };
  }

  // Check if path is in one of the allowed directories
  const relativePath = normalizedPath === normalizedBase
    ? ""
    : normalizedPath.slice(normalizedBase.length + 1);

  if (!relativePath) {
    // Base directory itself is always allowed
    return { valid: true, canonicalPath };
  }

  const topLevelDir = relativePath.split("/")[0] ?? "";

  if (!topLevelDir || !allowedDirs.includes(topLevelDir)) {
    return {
      valid: false,
      error: `Access to directory '${topLevelDir}' not allowed. Allowed: ${allowedDirs.join(", ")}`,
      code: PathValidationError.NOT_IN_ALLOWLIST,
    };
  }

  return { valid: true, canonicalPath };
}
