/**************************************************
 * Canonical Path Resolution
 * @module security/path-validation/canonical
 **************************************************/

import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";

import { isWithinDirectory, normalizeSeparators, resolvePathSegments } from "./normalization.ts";
import { PathValidationError, type ValidationResult } from "./types.ts";

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
    } catch (_) {
      /* expected: path may not exist yet (e.g. writes/mkdir) */
    }
  }

  // Resolve the PHYSICAL path so containment is checked against the real target:
  // a symlink (including an intermediate symlinked component) whose real target
  // escapes the base directory must be rejected. realPath() resolves the whole
  // chain, so it also catches symlinked parent segments that lstat on the final
  // component alone would miss.
  //
  // Residual gap: adapters that expose neither realPath nor lstat (virtual/remote
  // filesystems — Veryfront API, GitHub — which have no OS-level symlinks) fall
  // back to the lexical path. Those filesystems cannot express an OS symlink
  // escape, so the lexical containment check remains sufficient there. A
  // hypothetical local-disk adapter lacking realPath would retain the pre-fix
  // lexical-only behavior for intermediate-symlink escapes.
  if (typeof fs.realPath === "function") {
    try {
      const real = await fs.realPath(path);
      return { path: resolvePathSegments(normalizeSeparators(real)), isSymlink };
    } catch (_) {
      /* expected: path may not exist yet (e.g. writes/mkdir). Use lexical path. */
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
    } catch (_) {
      /* expected: base may not exist in tests/virtual fs. Use lexical base. */
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
