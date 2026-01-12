/**
 * HTTP Module Fetcher
 *
 * Fallback module fetching via HTTP for modules not available locally.
 *
 * @module build/transforms/mdx/esm-loader/fetcher/http
 */

import { rendererLogger as logger } from "@veryfront/utils";
import { LOG_PREFIX_MDX_LOADER } from "../constants.ts";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";

/**
 * Fetch a module via HTTP.
 * This is a fallback for when direct file reading fails.
 *
 * @param normalizedPath - The module path (e.g., "_vf_modules/components/Foo.js")
 * @param adapter - Runtime adapter for env access
 * @returns Module code or null if fetch fails
 */
export async function fetchModuleViaHttp(
  normalizedPath: string,
  adapter: RuntimeAdapter,
): Promise<string | null> {
  // In proxy mode, HTTP fallback to localhost won't work (self-referential request)
  const isProxyMode = adapter.env.get("PROXY_MODE") === "1";
  if (isProxyMode) {
    const filePathWithoutJs = normalizedPath.replace(/^_vf_modules\//, "").replace(/\.js$/, "");
    logger.warn(
      `${LOG_PREFIX_MDX_LOADER} Direct read failed in proxy mode (module must be pre-loaded): ${filePathWithoutJs}`,
    );
    return null;
  }

  // Try multiple port sources
  const port = adapter.env.get("VERYFRONT_DEV_PORT") || adapter.env.get("PORT") || "3001";
  const moduleUrl = `http://localhost:${port}/${normalizedPath}?ssr=true`;

  logger.debug(`${LOG_PREFIX_MDX_LOADER} Fetching module via HTTP: ${moduleUrl}`);

  const response = await fetch(moduleUrl);
  if (!response.ok) {
    logger.warn(
      `${LOG_PREFIX_MDX_LOADER} HTTP fetch failed: ${moduleUrl} (${response.status})`,
    );
    return null;
  }

  return await response.text();
}

/**
 * Extract nested imports from module code.
 *
 * @param moduleCode - The module code to scan
 * @returns Array of imports to process
 */
export function extractNestedImports(
  moduleCode: string,
): { vfModules: Array<{ original: string; path: string }>; relative: Array<{ original: string; path: string }> } {
  const vfModulePattern = /from\s+["'](\/?_vf_modules\/[^"'?]+)(?:\?[^"']*)?["']/g;
  const relativePattern = /from\s+["'](\.\.?\/[^"'?]+)(?:\?[^"']*)?["']/g;

  const vfModules: Array<{ original: string; path: string }> = [];
  const relative: Array<{ original: string; path: string }> = [];

  let match;
  while ((match = vfModulePattern.exec(moduleCode)) !== null) {
    if (match[1]) {
      vfModules.push({ original: match[0], path: match[1].replace(/^\//, "") });
    }
  }

  while ((match = relativePattern.exec(moduleCode)) !== null) {
    if (match[1]) {
      relative.push({ original: match[0], path: match[1] });
    }
  }

  return { vfModules, relative };
}

/**
 * Check if module code has unresolved _vf_modules imports.
 *
 * @param moduleCode - The module code to check
 * @returns Array of unresolved import paths
 */
export function getUnresolvedImports(moduleCode: string): string[] {
  const unresolvedPattern = /from\s+["'](\/?_vf_modules\/[^"']+)["']/g;
  const matches = [...moduleCode.matchAll(unresolvedPattern)];
  return matches.map((m) => m[1]).filter((p): p is string => !!p);
}
