/**
 * ESM Path Rewriter
 *
 * Rewrites import/export paths in esm.sh code to resolve correctly.
 *
 * @module rendering/orchestrator/module-loader/esm-rewriter
 */

import { rendererLogger as logger } from "#veryfront/utils";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { generateHash } from "./cache.ts";

/**
 * Rewrite import/export paths in esm.sh code.
 * Transforms absolute paths to https://esm.sh URLs and relative paths to resolved URLs.
 */
export function rewriteEsmPaths(code: string, urlBase: string): string {
  const resolveAbsolute = (path: string): string => `https://esm.sh${path}`;
  const resolveRelative = (path: string): string => new URL(path, urlBase).href;

  // Pattern configs: [pathPattern, pathGroupIndex, resolver]
  type PathResolver = (path: string) => string;
  const patterns: Array<[RegExp, number, PathResolver]> = [
    // Absolute paths (like "/@radix-ui/..." or "/react@...")
    [/import\s*(["'])(\/[^"']+)\1/g, 2, resolveAbsolute],
    [/from\s*(["'])(\/[^"']+)\1/g, 2, resolveAbsolute],
    [/export\s*\*\s*from\s*(["'])(\/[^"']+)\1/g, 2, resolveAbsolute],
    [/export\s*\{([^}]+)\}\s*from\s*(["'])(\/[^"']+)\2/g, 3, resolveAbsolute],
    // Relative paths (like "./dist/..." or "../utils/...")
    [/import\s*(["'])(\.\.?\/[^"']+)\1/g, 2, resolveRelative],
    [/from\s*(["'])(\.\.?\/[^"']+)\1/g, 2, resolveRelative],
    [/export\s*\*\s*from\s*(["'])(\.\.?\/[^"']+)\1/g, 2, resolveRelative],
    [/export\s*\{([^}]+)\}\s*from\s*(["'])(\.\.?\/[^"']+)\2/g, 3, resolveRelative],
  ];

  let result = code;
  for (const [pattern, pathIndex, resolver] of patterns) {
    result = result.replace(pattern, (...args) => {
      const match = args[0] as string;
      const path = args[pathIndex - 1] as string;
      const resolved = resolver(path);
      // Replace the path portion while preserving the rest of the match structure
      const quote = pathIndex === 3 ? args[2] : args[1];
      return match.replace(
        new RegExp(`${quote}${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}${quote}`),
        `${quote}${resolved}${quote}`,
      );
    });
  }

  return result;
}

/**
 * Fetch and cache an esm.sh module.
 *
 * @param url - The esm.sh URL to fetch
 * @param tmpDir - Temp directory for caching
 * @param localAdapter - Local file system adapter
 * @param esmCache - Cache map for esm modules
 * @returns Path to the cached module file
 */
export async function fetchEsmModule(
  url: string,
  tmpDir: string,
  localAdapter: RuntimeAdapter,
  esmCache: Map<string, string>,
): Promise<string> {
  if (esmCache.has(url)) {
    return esmCache.get(url)!;
  }

  logger.debug("[ModuleLoader] Fetching esm.sh module:", url);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }

  let code = await response.text();

  // Transform relative esm.sh paths to absolute URLs
  // esm.sh code is often minified with no spaces (e.g., from"/@pkg/...")
  const urlBase = url.substring(0, url.lastIndexOf("/") + 1);
  code = rewriteEsmPaths(code, urlBase);

  // Find ALL esm.sh URLs in the code and fetch/replace them
  // Use a simple pattern to find all https://esm.sh URLs
  const allEsmUrls = new Set<string>();
  const urlPattern = /["'](https:\/\/esm\.sh\/[^"']+)["']/g;
  let match;
  while ((match = urlPattern.exec(code)) !== null) {
    allEsmUrls.add(match[1]!);
  }

  // Fetch and cache all URLs in parallel for better performance
  const urlArray = Array.from(allEsmUrls);
  const cachedPaths = await Promise.all(
    urlArray.map((esmUrl) => fetchEsmModule(esmUrl, tmpDir, localAdapter, esmCache)),
  );

  // Replace all occurrences with cached paths using single-pass replacement
  // This avoids O(n²) complexity from repeated split/join operations
  if (urlArray.length > 0) {
    const replacementMap = new Map<string, string>();
    for (let i = 0; i < urlArray.length; i++) {
      replacementMap.set(urlArray[i]!, `file://${cachedPaths[i]}`);
    }

    // Build regex that matches any of the URLs (escaped for regex safety)
    const escapedUrls = urlArray.map((u) => u.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const combinedPattern = new RegExp(escapedUrls.join("|"), "g");

    code = code.replace(combinedPattern, (match) => replacementMap.get(match) ?? match);
  }

  // Generate hash for the URL to create unique filename
  const hash = await generateHash(url);
  const tempFilePath = `${tmpDir}/esm-${hash}.js`;
  await localAdapter.fs.writeFile(tempFilePath, code);

  esmCache.set(url, tempFilePath);
  return tempFilePath;
}
