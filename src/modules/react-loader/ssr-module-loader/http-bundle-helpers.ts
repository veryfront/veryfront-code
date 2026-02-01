/**
 * HTTP Bundle Validation Helpers for SSR Module Loader
 *
 * Extracts and validates HTTP bundle paths from transformed code.
 * Used to proactively recover missing bundles before module import.
 *
 * @module module-system/react-loader/ssr-module-loader/http-bundle-helpers
 */

import { createFileSystem, exists } from "#veryfront/platform/compat/fs.ts";
import { LRUCache } from "#veryfront/utils/lru-wrapper.ts";

/**
 * Extract VF module paths (veryfront-mdx-esm/*.mjs) from code.
 * These are user project modules that may import HTTP bundles.
 */
export function extractVfModulePaths(code: string): string[] {
  // Create regex per call to avoid shared lastIndex state across concurrent calls.
  const vfModulePattern = /file:\/\/([^"'\s]+veryfront-mdx-esm\/[^"'\s]+\.mjs)/gi;
  const paths: string[] = [];
  const seen = new Set<string>();
  let match;
  while ((match = vfModulePattern.exec(code)) !== null) {
    const path = match[1] as string;
    // Strip query params for path comparison
    const cleanPath = path.replace(/\?.*$/, "");
    if (!seen.has(cleanPath)) {
      seen.add(cleanPath);
      paths.push(cleanPath);
    }
  }
  return paths;
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
  const seenVfModules = new Set<string>();
  const fs = createFileSystem();

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

  // Process VF module imports recursively
  const pendingVfModules = extractVfModulePaths(code);

  while (pendingVfModules.length > 0) {
    const vfModulePath = pendingVfModules.pop()!;
    if (seenVfModules.has(vfModulePath)) continue;
    seenVfModules.add(vfModulePath);

    // Check if the VF module exists locally
    if (!(await exists(vfModulePath))) continue;

    try {
      const vfModuleCode = await fs.readTextFile(vfModulePath);

      // Extract HTTP bundles from this VF module
      const vfBundles = extractHttpBundlePaths(vfModuleCode);
      addBundles(vfBundles);

      // Extract more VF modules for recursive processing
      const nestedVfModules = extractVfModulePaths(vfModuleCode);
      for (const nestedPath of nestedVfModules) {
        if (!seenVfModules.has(nestedPath)) {
          pendingVfModules.push(nestedPath);
        }
      }
    } catch {
      // Ignore read errors for VF modules
    }
  }

  return allBundles;
}

/** Extract HTTP bundle paths from transformed code for proactive recovery */
export function extractHttpBundlePaths(code: string): Array<{ path: string; hash: string }> {
  // Create regex per call to avoid shared lastIndex state across concurrent calls.
  // Note: The hash is a decimal number from simpleHash(), not hex, so we match \d+ not [a-f0-9]+
  const httpBundlePattern = /file:\/\/([^"'\s]+veryfront-http-bundle\/http-(\d+)\.mjs)/gi;

  const bundles: Array<{ path: string; hash: string }> = [];
  const seen = new Set<string>();

  let match: RegExpExecArray | null;
  while ((match = httpBundlePattern.exec(code)) !== null) {
    const path = match[1];
    const hash = match[2];

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
  // Create regex per call to avoid shared lastIndex state across concurrent calls.
  const allFilePathsPattern = /file:\/\/([^"'\s]+\.(?:mjs|js))/gi;

  const paths: string[] = [];
  const seen = new Set<string>();

  let match: RegExpExecArray | null;
  while ((match = allFilePathsPattern.exec(code)) !== null) {
    const path = match[1];

    if (!path || seen.has(path)) continue;

    seen.add(path);
    paths.push(path);
  }

  return paths;
}

/**
 * Track modules whose HTTP bundles have been verified, keyed by tempPath:contentHash.
 * Bounded LRU to prevent unbounded memory growth in long-running pods.
 * Keying by contentHash ensures verification is re-done when content changes at the same path.
 */
export const verifiedHttpBundlePaths = new LRUCache<string, true>({ maxEntries: 2000 });
