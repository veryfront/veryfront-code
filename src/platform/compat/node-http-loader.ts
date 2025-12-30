/**
 * Node.js HTTP Module Loader
 *
 * Enables JIT loading of ES modules from HTTP/HTTPS URLs in Node.js,
 * similar to Deno's native behavior.
 *
 * Usage:
 *   import { register } from 'node:module';
 *   register('./node-http-loader.ts', import.meta.url);
 *
 * Or via CLI:
 *   node --import ./register-http-loader.js your-app.js
 *
 * @module platform/compat/node-http-loader
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Cache directory for fetched modules
const CACHE_DIR = join(tmpdir(), "veryfront-module-cache");

interface ResolveContext {
  conditions: string[];
  importAttributes: Record<string, string>;
  parentURL?: string;
}

interface LoadContext {
  conditions: string[];
  importAttributes: Record<string, string>;
  format?: string;
}

type NextResolve = (
  specifier: string,
  context?: ResolveContext
) => Promise<{ url: string; format?: string; shortCircuit?: boolean }>;

type NextLoad = (
  url: string,
  context?: LoadContext
) => Promise<{ format: string; source: string | ArrayBuffer; shortCircuit?: boolean }>;

/**
 * Generate a cache key for a URL
 */
function getCacheKey(url: string): string {
  return createHash("sha256").update(url).digest("hex").slice(0, 16);
}

/**
 * Get cached module path
 */
function getCachePath(url: string): string {
  const key = getCacheKey(url);
  const ext = url.includes(".mjs") ? ".mjs" : ".js";
  return join(CACHE_DIR, `${key}${ext}`);
}

/**
 * Ensure cache directory exists
 */
async function ensureCacheDir(): Promise<void> {
  try {
    await mkdir(CACHE_DIR, { recursive: true });
  } catch {
    // Directory may already exist
  }
}

/**
 * Try to read from cache
 */
async function readFromCache(url: string): Promise<string | null> {
  try {
    const cachePath = getCachePath(url);
    const content = await readFile(cachePath, "utf-8");
    return content;
  } catch {
    return null;
  }
}

/**
 * Write to cache
 */
async function writeToCache(url: string, content: string): Promise<void> {
  try {
    await ensureCacheDir();
    const cachePath = getCachePath(url);
    await writeFile(cachePath, content, "utf-8");
  } catch (error) {
    console.warn(`[http-loader] Failed to cache ${url}:`, error);
  }
}

/**
 * Fetch module from HTTP/HTTPS URL
 */
async function fetchModule(url: string): Promise<string> {
  // Check cache first
  const cached = await readFromCache(url);
  if (cached) {
    return cached;
  }

  // Fetch from network
  const response = await fetch(url, {
    headers: {
      "Accept": "application/javascript, text/javascript, */*",
      "User-Agent": "veryfront-node-loader/1.0",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }

  const content = await response.text();

  // Cache for future use
  await writeToCache(url, content);

  return content;
}

/**
 * Resolve hook - intercepts module specifiers
 *
 * Handles:
 * - https:// URLs -> pass through
 * - http:// URLs -> pass through
 * - Relative imports from HTTP modules -> resolve to absolute HTTP URL
 */
export function resolve(
  specifier: string,
  context: ResolveContext,
  nextResolve: NextResolve
): Promise<{ url: string; format?: string; shortCircuit?: boolean }> | { url: string; format?: string; shortCircuit?: boolean } {
  // Handle absolute HTTP(S) URLs
  if (specifier.startsWith("https://") || specifier.startsWith("http://")) {
    return {
      url: specifier,
      format: "module",
      shortCircuit: true,
    };
  }

  // Handle relative imports from HTTP parent
  if (context.parentURL?.startsWith("https://") || context.parentURL?.startsWith("http://")) {
    if (specifier.startsWith("./") || specifier.startsWith("../")) {
      const resolved = new URL(specifier, context.parentURL).href;
      return {
        url: resolved,
        format: "module",
        shortCircuit: true,
      };
    }

    // Bare specifier from HTTP module - resolve via esm.sh
    if (!specifier.startsWith("/") && !specifier.startsWith(".")) {
      const esmUrl = `https://esm.sh/${specifier}`;
      return {
        url: esmUrl,
        format: "module",
        shortCircuit: true,
      };
    }
  }

  // Fall through to default resolution
  return nextResolve(specifier, context);
}

/**
 * Load hook - fetches module content
 *
 * For HTTP(S) URLs, fetches content and returns as ES module
 */
export async function load(
  url: string,
  context: LoadContext,
  nextLoad: NextLoad
): Promise<{ format: string; source: string | ArrayBuffer; shortCircuit?: boolean }> {
  // Handle HTTP(S) URLs
  if (url.startsWith("https://") || url.startsWith("http://")) {
    const source = await fetchModule(url);
    return {
      format: "module",
      source,
      shortCircuit: true,
    };
  }

  // Fall through to default loading
  return nextLoad(url, context);
}

/**
 * Initialize hook - called when loader is registered
 */
export function initialize(data?: { clearCache?: boolean }): void {
  if (data?.clearCache) {
    // Could clear cache here if needed
    console.log("[http-loader] Initialized with cache clearing");
  }
}
