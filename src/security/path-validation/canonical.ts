/**************************************************
 * Canonical Path Resolution
 * @module security/path-validation/canonical
 **************************************************/

import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { isNotFoundError } from "#veryfront/platform/compat/fs.ts";
import { basename, dirname, join, relative } from "#veryfront/compat/path/index.ts";

import { isWithinDirectory, normalizeSeparators, resolvePathSegments } from "./normalization.ts";
import { PathValidationError, type ValidationResult } from "./types.ts";

function dirnamePreservingDriveRoot(path: string): string {
  const parent = dirname(path);
  return /^[A-Za-z]:$/.test(parent) && /^[A-Za-z]:\//.test(path) ? `${parent}/` : parent;
}

/** Resolve a physical path through its nearest existing ancestor, or return null. */
export async function resolveThroughExistingAncestor(
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
  adapter: RuntimeAdapter,
): Promise<{ path: string; isSymlink: boolean }> {
  const resolvedPath = resolvePathSegments(path);

  if (typeof adapter !== "object" || adapter === null) {
    throw new TypeError("Physical canonicalization requires a runtime adapter");
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
  // validatePath() admits this lexical fallback only for adapters that
  // explicitly declare symlink-free storage, or when lstat is sufficient for
  // a no-follow policy. Direct callers use this helper only for resolution and
  // must apply their own capability policy.
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
 * Detect a terminal or intermediate symlink below a trusted lexical root.
 * The root itself is excluded: callers separately canonicalize it so a
 * deployment path such as macOS `/var` may legitimately resolve elsewhere.
 */
export async function pathTraversesSymlink(
  path: string,
  baseDir: string,
  adapter: RuntimeAdapter,
): Promise<boolean> {
  const fs = adapter.fs;
  const lstat = fs.lstat;
  if (!lstat) return false;

  const normalizedBase = resolvePathSegments(normalizeSeparators(baseDir));
  const normalizedPath = resolvePathSegments(normalizeSeparators(path));
  if (!isWithinDirectory(normalizedBase, normalizedPath)) return false;

  const relativePath = normalizeSeparators(relative(normalizedBase, normalizedPath));
  if (!relativePath || relativePath === ".") return false;

  let candidate = normalizedBase;
  for (const segment of relativePath.split("/")) {
    if (!segment || segment === ".") continue;
    candidate = join(candidate, segment);
    try {
      if ((await lstat.call(fs, candidate)).isSymlink) return true;
    } catch (error) {
      if (isNotFoundError(error)) return false;
      throw error;
    }
  }
  return false;
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
  adapter: RuntimeAdapter,
): Promise<string> {
  const fs = adapter.fs;
  if (typeof fs.realPath === "function") {
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
  allowedDirs: string[] | undefined,
): ValidationResult {
  const normalizedBase = resolvePathSegments(normalizeSeparators(baseDir)).replace(/\/$/, "");
  const normalizedPath = resolvePathSegments(normalizeSeparators(canonicalPath)).replace(/\/$/, "");

  if (!isWithinDirectory(normalizedBase, normalizedPath)) {
    return {
      valid: false,
      error: "Path is outside base directory",
      code: PathValidationError.OUTSIDE_BASE,
    };
  }

  if (allowedDirs === undefined || normalizedPath === normalizedBase) {
    return { valid: true, canonicalPath };
  }

  const relativePath = normalizedPath.slice(normalizedBase.length + 1);
  const topLevelDir = relativePath.split("/")[0] ?? "";

  if (!topLevelDir || !allowedDirs.includes(topLevelDir)) {
    return {
      valid: false,
      error: allowedDirs.length === 0
        ? `Access to directory '${topLevelDir}' not allowed: directory allowlist is empty`
        : `Access to directory '${topLevelDir}' not allowed. Allowed: ${allowedDirs.join(", ")}`,
      code: PathValidationError.NOT_IN_ALLOWLIST,
    };
  }

  return { valid: true, canonicalPath };
}
