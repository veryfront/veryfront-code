/**
 * HTTP Bundle Validation Helpers for SSR Module Loader
 *
 * Extracts and validates HTTP bundle paths from transformed code.
 * Used to proactively recover missing bundles before module import.
 *
 * @module module-system/react-loader/ssr-module-loader/http-bundle-helpers
 */

import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { LRUCache } from "#veryfront/utils/lru-wrapper.ts";
import { getMdxEsmCacheDir } from "#veryfront/utils/cache-dir.ts";
import { fromFileUrl, isAbsolute, relative, resolve } from "#veryfront/compat/path/index.ts";
import { findModuleSpecifierSpans } from "#veryfront/modules/loader-shared/import-specifiers.ts";

/** Max entries in the verified HTTP bundle paths LRU cache */
const VERIFIED_BUNDLE_CACHE_MAX_ENTRIES = 2_000;
const MAX_EXTRACTED_MODULE_PATHS = 2_048;
const MAX_MODULE_SPECIFIER_LENGTH = 8_192;
const MAX_VF_MODULE_SOURCE_BYTES = 5 * 1024 * 1024;

function importedSpecifiers(code: string): string[] {
  return findModuleSpecifierSpans(code)
    .slice(0, MAX_EXTRACTED_MODULE_PATHS)
    .map((span) => span.specifier)
    .filter((specifier) => specifier.length <= MAX_MODULE_SPECIFIER_LENGTH);
}

function filePathFromSpecifier(specifier: string): string | null {
  if (!specifier.startsWith("file://")) return null;
  try {
    return fromFileUrl(specifier);
  } catch {
    return null;
  }
}

function isPathWithin(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "." || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith("../"));
}

/**
 * Extract VF module paths (veryfront-mdx-esm/*.mjs) from code.
 * These are user project modules that may import HTTP bundles.
 */
function extractVfModulePaths(code: string): string[] {
  const paths: string[] = [];
  const seen = new Set<string>();
  for (const specifier of importedSpecifiers(code)) {
    const path = filePathFromSpecifier(specifier);
    if (!path || !path.includes("/veryfront-mdx-esm/") || !path.endsWith(".mjs")) continue;
    if (seen.has(path)) continue;
    seen.add(path);
    paths.push(path);
  }
  return paths;
}

/**
 * Visit VF module code blocks imported by the given module, including nested VF modules.
 * The visitor receives both the module code and the absolute vfmod file path.
 */
export async function visitImportedVfModules(
  code: string,
  visitor: (vfModuleCode: string, vfModulePath?: string) => void | Promise<void>,
): Promise<void> {
  const seenVfModules = new Set<string>();
  const pendingVfModules = extractVfModulePaths(code);
  const fs = createFileSystem();
  const cacheRoot = resolve(getMdxEsmCacheDir());
  let canonicalCacheRoot = cacheRoot;
  try {
    canonicalCacheRoot = fs.realPath ? await fs.realPath(cacheRoot) : cacheRoot;
  } catch {
    return;
  }

  while (
    pendingVfModules.length > 0 && seenVfModules.size < MAX_EXTRACTED_MODULE_PATHS
  ) {
    const vfModulePath = pendingVfModules.pop()!;
    if (seenVfModules.has(vfModulePath)) continue;
    seenVfModules.add(vfModulePath);

    const resolvedPath = resolve(vfModulePath);
    if (!isPathWithin(cacheRoot, resolvedPath)) continue;

    let vfModuleCode: string;
    try {
      const linkInfo = fs.lstat ? await fs.lstat(resolvedPath) : undefined;
      if (linkInfo?.isSymlink) continue;

      const canonicalPath = fs.realPath ? await fs.realPath(resolvedPath) : resolvedPath;
      if (!isPathWithin(canonicalCacheRoot, canonicalPath)) continue;

      const info = await fs.stat(canonicalPath);
      if (!info.isFile || info.size < 0 || info.size > MAX_VF_MODULE_SOURCE_BYTES) continue;
      vfModuleCode = await fs.readTextFile(canonicalPath);
      if (new TextEncoder().encode(vfModuleCode).byteLength > MAX_VF_MODULE_SOURCE_BYTES) continue;
    } catch {
      /* expected: VF module file may fail to read */
      continue;
    }

    await visitor(vfModuleCode, resolvedPath);

    const nestedVfModules = extractVfModulePaths(vfModuleCode);
    for (const nestedPath of nestedVfModules) {
      if (
        !seenVfModules.has(nestedPath) &&
        pendingVfModules.length + seenVfModules.size < MAX_EXTRACTED_MODULE_PATHS
      ) {
        pendingVfModules.push(nestedPath);
      }
    }
  }
}

/**
 * Recursively extract all HTTP bundle paths from code and any VF modules it imports.
 * This ensures transitive HTTP bundle dependencies through VF modules are discovered.
 */
export async function extractAllHttpBundlePathsRecursive(
  code: string,
): Promise<Array<{ path: string; hash: string }>> {
  const allBundles: Array<{ path: string; hash: string }> = [];
  const seenHashes = new Set<string>();

  // Helper to add bundles without duplicates
  const addBundles = (bundles: Array<{ path: string; hash: string }>) => {
    for (const bundle of bundles) {
      if (allBundles.length >= MAX_EXTRACTED_MODULE_PATHS) return;
      if (!seenHashes.has(bundle.hash)) {
        seenHashes.add(bundle.hash);
        allBundles.push(bundle);
      }
    }
  };

  // Process initial code
  const directBundles = extractHttpBundlePaths(code);
  addBundles(directBundles);

  await visitImportedVfModules(code, (vfModuleCode) => {
    // Extract HTTP bundles from this VF module
    const vfBundles = extractHttpBundlePaths(vfModuleCode);
    addBundles(vfBundles);
  });

  return allBundles;
}

/** Extract HTTP bundle paths from transformed code for proactive recovery */
export function extractHttpBundlePaths(code: string): Array<{ path: string; hash: string }> {
  const bundles: Array<{ path: string; hash: string }> = [];
  const seen = new Set<string>();

  for (const specifier of importedSpecifiers(code)) {
    const relativeMatch = /^\.\/http-([a-f0-9]{1,128})\.mjs(?:[?#].*)?$/i.exec(specifier);
    if (relativeMatch?.[1]) {
      const hash = relativeMatch[1];
      if (!seen.has(hash)) {
        seen.add(hash);
        bundles.push({ path: `http-${hash}.mjs`, hash });
      }
      continue;
    }

    const path = filePathFromSpecifier(specifier);
    const absoluteMatch = path
      ? /\/veryfront-http-bundle\/http-([a-f0-9]{1,128})\.mjs$/i.exec(path)
      : null;
    const hash = absoluteMatch?.[1];
    if (!path || !hash || seen.has(hash)) continue;
    seen.add(hash);
    bundles.push({ path, hash });
  }

  return bundles;
}

/**
 * Extract ALL file:// paths from cached code (local imports + HTTP bundles).
 * Used to validate that all paths in cached transforms exist locally before use.
 * This prevents "Module not found" errors when Redis returns transforms from
 * other pods with different temp directories.
 */
export function extractAllFilePaths(code: string): string[] {
  const paths: string[] = [];
  const seen = new Set<string>();

  for (const specifier of importedSpecifiers(code)) {
    const path = filePathFromSpecifier(specifier);
    if (!path || !/\.(?:mjs|js|tsx|ts|jsx)$/i.test(path) || seen.has(path)) continue;

    seen.add(path);
    paths.push(path);
  }

  return paths;
}

/**
 * Extract all file:// paths from cached code and any transitively imported VF modules.
 * This catches stale pod-local paths that only appear in nested vfmod dependencies.
 */
export async function extractAllFilePathsRecursive(code: string): Promise<string[]> {
  const paths: string[] = [];
  const seen = new Set<string>();

  const addPaths = (entries: string[]) => {
    for (const path of entries) {
      if (paths.length >= MAX_EXTRACTED_MODULE_PATHS) return;
      if (seen.has(path)) continue;
      seen.add(path);
      paths.push(path);
    }
  };

  addPaths(extractAllFilePaths(code));

  await visitImportedVfModules(code, (vfModuleCode) => {
    addPaths(extractAllFilePaths(vfModuleCode));
  });

  return paths;
}

/**
 * Track modules whose HTTP bundles have been verified, keyed by a framed path/hash tuple.
 * Bounded LRU to prevent unbounded memory growth in long-running pods.
 * Keying by contentHash ensures verification is re-done when content changes at the same path.
 */
export const verifiedHttpBundlePaths = new LRUCache<string, true>({
  maxEntries: VERIFIED_BUNDLE_CACHE_MAX_ENTRIES,
});

/** Build an unambiguous verification identity for one transformed module file. */
export function buildVerifiedHttpBundleKey(tempPath: string, contentHash: string): string {
  return JSON.stringify([tempPath, contentHash]);
}
