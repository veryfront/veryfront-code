/**
 * HTTP Bundle Validation Helpers for SSR Module Loader
 *
 * Extracts and validates HTTP bundle paths from transformed code.
 * Used to proactively recover missing bundles before module import.
 *
 * @module module-system/react-loader/ssr-module-loader/http-bundle-helpers
 */

import { createFileSystem, isNotFoundError, realPath } from "#veryfront/platform/compat/fs.ts";
import {
  dirname,
  fromFileUrl,
  isAbsolute,
  relative,
  resolve,
} from "#veryfront/compat/path/index.ts";
import { LRUCache } from "#veryfront/utils/lru-wrapper.ts";
import { parseImports } from "#veryfront/transforms/esm/lexer.ts";
import { getMdxEsmCacheDir } from "#veryfront/utils/cache-dir.ts";

/** Max entries in the verified HTTP bundle paths LRU cache */
const VERIFIED_BUNDLE_CACHE_MAX_ENTRIES = 2_000;
const MAX_RECURSIVE_VF_MODULES = 500;
const MAX_VF_MODULE_BYTES = 10 * 1024 * 1024;
const MAX_VF_MODULE_PATH_LENGTH = 16 * 1024;

function isPathWithin(candidatePath: string, basePath: string): boolean {
  const relativePath = relative(basePath, candidatePath);
  const escapesBase = relativePath === ".." ||
    relativePath.startsWith("../") ||
    relativePath.startsWith("..\\");
  return !escapesBase && !isAbsolute(relativePath);
}

/**
 * Extract VF module paths (veryfront-mdx-esm/*.mjs) from code.
 * These are user project modules that may import HTTP bundles.
 */
async function extractVfModulePaths(
  code: string,
  cacheRoot: string,
  canonicalCacheRoot: string,
  importerPath?: string,
): Promise<string[]> {
  const imports = await parseImports(code);
  const paths: string[] = [];
  const seen = new Set<string>();

  for (const imported of imports) {
    const specifier = imported.n;
    if (!specifier) continue;

    let candidatePath: string;
    try {
      if (specifier.startsWith("file:")) {
        const url = new URL(specifier);
        if (url.protocol !== "file:") continue;
        url.search = "";
        url.hash = "";
        candidatePath = fromFileUrl(url);
      } else if (
        importerPath &&
        (specifier.startsWith("./") || specifier.startsWith("../"))
      ) {
        candidatePath = resolve(dirname(importerPath), specifier);
      } else {
        continue;
      }
    } catch {
      continue;
    }

    if (
      candidatePath.length === 0 ||
      candidatePath.length > MAX_VF_MODULE_PATH_LENGTH ||
      !candidatePath.endsWith(".mjs")
    ) {
      continue;
    }

    const lexicalPath = resolve(candidatePath);
    if (!isPathWithin(lexicalPath, cacheRoot)) continue;

    let canonicalPath: string;
    try {
      canonicalPath = await realPath(lexicalPath);
    } catch (error) {
      if (isNotFoundError(error)) continue;
      throw error;
    }
    if (
      !isPathWithin(canonicalPath, canonicalCacheRoot) ||
      seen.has(canonicalPath)
    ) {
      continue;
    }
    seen.add(canonicalPath);
    paths.push(canonicalPath);
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
  const cacheRoot = resolve(getMdxEsmCacheDir());
  let canonicalCacheRoot: string;
  try {
    canonicalCacheRoot = await realPath(cacheRoot);
  } catch (error) {
    if (isNotFoundError(error)) return;
    throw error;
  }
  const pendingVfModules = await extractVfModulePaths(
    code,
    cacheRoot,
    canonicalCacheRoot,
  );
  const fs = createFileSystem();

  while (pendingVfModules.length > 0) {
    const vfModulePath = pendingVfModules.pop()!;
    if (seenVfModules.has(vfModulePath)) continue;
    if (seenVfModules.size >= MAX_RECURSIVE_VF_MODULES) {
      throw new RangeError(
        `VF module dependency graph exceeds ${MAX_RECURSIVE_VF_MODULES} modules`,
      );
    }
    seenVfModules.add(vfModulePath);

    try {
      const stat = await fs.stat(vfModulePath);
      if (!stat.isFile) continue;
      if (stat.size > MAX_VF_MODULE_BYTES) {
        throw new RangeError(
          `VF module exceeds ${MAX_VF_MODULE_BYTES} bytes: ${vfModulePath}`,
        );
      }
      const vfModuleCode = await fs.readTextFile(vfModulePath);
      await visitor(vfModuleCode, vfModulePath);

      const nestedVfModules = await extractVfModulePaths(
        vfModuleCode,
        cacheRoot,
        canonicalCacheRoot,
        vfModulePath,
      );
      for (const nestedPath of nestedVfModules) {
        if (!seenVfModules.has(nestedPath)) {
          pendingVfModules.push(nestedPath);
        }
      }
    } catch (error) {
      if (isNotFoundError(error)) continue;
      throw error;
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
  // Create regex per call to avoid shared lastIndex state across concurrent calls.
  const bundles: Array<{ path: string; hash: string }> = [];
  const seen = new Set<string>();

  // Match absolute file:// paths (legacy format)
  const absolutePattern = /file:\/\/([^"'\s]+veryfront-http-bundle\/http-([a-f0-9]+)\.mjs)/gi;
  let match: RegExpExecArray | null;
  while ((match = absolutePattern.exec(code)) !== null) {
    const path = match[1];
    const hash = match[2];
    if (!path || !hash || seen.has(hash)) continue;
    seen.add(hash);
    bundles.push({ path, hash });
  }

  // Match relative paths (new portable format): ./http-{hash}.mjs
  // These are used when HTTP bundles import other HTTP bundles for cross-environment portability
  const relativePattern = /["']\.\/http-([a-f0-9]+)\.mjs["']/gi;
  while ((match = relativePattern.exec(code)) !== null) {
    const hash = match[1];
    if (!hash || seen.has(hash)) continue;
    seen.add(hash);
    // For relative paths, just store the filename since it's in the same directory
    bundles.push({ path: `http-${hash}.mjs`, hash });
  }

  return bundles;
}

/**
 * Extract ALL file:// paths from cached code (local imports + HTTP bundles).
 * Used to validate that all paths in cached transforms exist locally before use.
 * This prevents "Module not found" errors when distributed storage returns transforms from
 * other pods with different temp directories.
 */
export function extractAllFilePaths(code: string): string[] {
  // Create regex per call to avoid shared lastIndex state across concurrent calls.
  const allFilePathsPattern = /file:\/\/(\/[^"'\s]+)/gi;
  const supportedPathPattern = /\.(?:mjs|js|tsx|ts|jsx)(?:\.src)?$/i;

  const paths: string[] = [];
  const seen = new Set<string>();

  let match: RegExpExecArray | null;
  while ((match = allFilePathsPattern.exec(code)) !== null) {
    const path = match[1]?.replace(/[?#].*$/, "");

    if (!path || !supportedPathPattern.test(path) || seen.has(path)) continue;

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
 * Track modules whose HTTP bundles have been verified, keyed by tempPath:contentHash.
 * Bounded LRU to prevent unbounded memory growth in long-running pods.
 * Keying by contentHash ensures verification is re-done when content changes at the same path.
 */
export const verifiedHttpBundlePaths = new LRUCache<string, true>({
  maxEntries: VERIFIED_BUNDLE_CACHE_MAX_ENTRIES,
});
