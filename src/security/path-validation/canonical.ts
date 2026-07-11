/**************************************************
 * Canonical Path Resolution
 * @module security/path-validation/canonical
 **************************************************/

import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { isNotFoundError } from "#veryfront/platform/compat/fs.ts";
import { basename, dirname, join } from "#veryfront/compat/path/index.ts";

import { isWithinDirectory, normalizeSeparators, resolvePathSegments } from "./normalization.ts";
import { PathValidationError, type ValidationResult } from "./types.ts";

function dirnamePreservingDriveRoot(path: string): string {
  const parent = dirname(path);
  return /^[A-Za-z]:$/.test(parent) && /^[A-Za-z]:\//.test(path) ? `${parent}/` : parent;
}

async function resolveThroughExistingAncestor(
  path: string,
  realPath: (candidate: string) => Promise<string>,
  allowNormalizedRetry = true,
): Promise<string | null> {
  const unresolvedSegments: string[] = [];
  const visited = new Set<string>();
  let candidate = path;

  while (!visited.has(candidate)) {
    visited.add(candidate);
    try {
      const canonicalAncestor = normalizeSeparators(await realPath(candidate));
      const unresolvedSuffix = unresolvedSegments.reverse().join("/");
      return resolvePathSegments(
        unresolvedSuffix ? join(canonicalAncestor, unresolvedSuffix) : canonicalAncestor,
      );
    } catch (error) {
      if (!isNotFoundError(error)) throw error;

      const parent = dirnamePreservingDriveRoot(candidate);
      if (parent === candidate) break;

      const segment = basename(candidate);
      if (!segment || segment === "/") break;
      if (segment === "." || segment === "..") {
        // A missing component before a traversal segment prevents realPath from
        // reaching an existing ancestor. Retry the lexically collapsed target,
        // then resolve its ancestors physically so a later symlink cannot escape.
        // If even that path has no canonical ancestor, fail closed.
        const normalizedPath = resolvePathSegments(path);
        if (allowNormalizedRetry && normalizedPath !== path) {
          const resolved = await resolveThroughExistingAncestor(
            normalizedPath,
            realPath,
            false,
          );
          if (resolved !== null) return resolved;
        }
        throw new Error("Cannot safely resolve a path through a missing traversal segment");
      }
      unresolvedSegments.push(segment);
      candidate = parent;
    }
  }

  return null;
}

export async function getCanonicalPath(
  path: string,
  adapter?: RuntimeAdapter,
  _followSymlinks = false,
): Promise<{ path: string; isSymlink: boolean }> {
  const resolvedPath = resolvePathSegments(path);

  if (!adapter) {
    return { path: resolvedPath, isSymlink: false };
  }

  const fs = adapter.fs;

  // Detect symlinks REGARDLESS of followSymlinks. adapter.fs.stat() follows
  // symlinks (Deno.stat/fs.stat semantics), so it always reports isSymlink:false
  // for a link and cannot detect an escape; lstat() reports the link itself.
  let isSymlink = false;
  if (typeof fs.lstat === "function") {
    try {
      const info = await fs.lstat(path);
      isSymlink = info.isSymlink;
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
      /* expected: path may not exist yet (e.g. writes/mkdir) */
    }
  }

  // Resolve the PHYSICAL path so containment is checked against the real target.
  // For a missing write target, resolve the nearest existing ancestor and append
  // the unresolved suffix. Calling realPath() only on the full target would fail
  // with ENOENT and let a symlinked parent escape via the lexical fallback.
  //
  // Residual gap: adapters that expose neither realPath nor lstat (virtual/remote
  // filesystems — Veryfront API, GitHub — which have no OS-level symlinks) fall
  // back to the lexical path. Those filesystems cannot express an OS symlink
  // escape, so the lexical containment check remains sufficient there. A
  // hypothetical local-disk adapter lacking realPath would retain the pre-fix
  // lexical-only behavior for intermediate-symlink escapes.
  if (typeof fs.realPath === "function") {
    const real = await resolveThroughExistingAncestor(
      normalizeSeparators(path),
      (candidate) => fs.realPath!(candidate),
    );
    if (real !== null) {
      return { path: real, isSymlink };
    }
  }

  return { path: resolvedPath, isSymlink };
}

/**
 * Resolve the base directory to its physical form so that a physically-resolved
 * candidate path is compared against a physically-resolved base. Without this,
 * a base whose own path contains symlinked segments (e.g. macOS /var → /private/var
 * or a temp dir) would spuriously fail containment once the candidate is resolved
 * to its real path. Falls back to the lexical base when realPath is unavailable
 * or the base does not exist.
 */
export async function getCanonicalBaseDir(
  baseDir: string,
  adapter?: RuntimeAdapter,
): Promise<string> {
  const fs = adapter?.fs;
  if (fs && typeof fs.realPath === "function") {
    try {
      return normalizeSeparators(await fs.realPath(baseDir));
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
      /* expected: base may not exist yet. Use the lexical base. */
    }
  }
  return baseDir;
}

export function validateAllowedDirs(
  canonicalPath: string,
  baseDir: string,
  allowedDirs: string[],
): ValidationResult {
  const normalizedBase = resolvePathSegments(normalizeSeparators(baseDir)).replace(/\/$/, "");
  const normalizedPath = resolvePathSegments(normalizeSeparators(canonicalPath)).replace(/\/$/, "");

  if (!isWithinDirectory(normalizedBase, normalizedPath)) {
    return {
      valid: false,
      error: `Path is outside base directory: ${baseDir}`,
      code: PathValidationError.OUTSIDE_BASE,
    };
  }

  if (!allowedDirs?.length || normalizedPath === normalizedBase) {
    return { valid: true, canonicalPath };
  }

  const relativePath = normalizedPath.slice(normalizedBase.length + 1);
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
