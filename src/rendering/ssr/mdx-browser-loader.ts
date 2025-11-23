/**
 * Browser-compatible MDX Module Loader
 * Uses Blob URLs for secure client-side dynamic imports (no eval/new Function)
 * @module
 */

import { rendererLogger as logger } from "@veryfront/utils";
import { CompilationError } from "@veryfront/errors/index.ts";
import type { MDXModule } from "./types.ts";

/**
 * Cache for loaded MDX modules (browser-side)
 */
const browserMDXCache = new Map<string, MDXModule>();

/**
 * Loads compiled MDX code in the browser using Blob URLs + dynamic import.
 * This is the secure browser alternative to new Function() or eval().
 *
 * How it works:
 * 1. Create an Object URL (Blob) from the compiled code
 * 2. Use dynamic import() to load it as an ESM module
 * 3. Revoke the Blob URL after loading to free memory
 *
 * @param compiledCode - The compiled MDX JavaScript code (ESM format)
 * @param cacheKey - Unique identifier for caching
 * @returns Promise resolving to the loaded MDX module
 *
 * @example
 * ```ts
 * // In browser context:
 * const module = await loadCompiledMDXInBrowser(compiledCode, 'blog-post-123')
 * const Component = module.default
 * ```
 */
export async function loadCompiledMDXInBrowser(
  compiledCode: string,
  cacheKey: string,
): Promise<MDXModule> {
  // Check cache first
  const cached = browserMDXCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  try {
    // Wrap code in proper ESM format with React imports
    const moduleCode = wrapForBrowser(compiledCode);

    // Create Blob URL for the module (browser-only feature)
    const blob = new Blob([moduleCode], { type: "application/javascript" });
    const blobURL = URL.createObjectURL(blob);

    try {
      // Use dynamic ESM import with Blob URL (secure!)
      const module = await import(blobURL) as MDXModule;

      const MDXContent = module.default || module.MDXContent;

      if (!MDXContent) {
        throw new CompilationError("No default export found in MDX module", {
          cacheKey,
          codePreview: compiledCode.substring(0, 200),
        });
      }

      // Cache the loaded module
      browserMDXCache.set(cacheKey, module);

      return module;
    } finally {
      // Revoke Blob URL to free memory (browser will keep module loaded)
      URL.revokeObjectURL(blobURL);
    }
  } catch (error) {
    logger.error("[MDX] Browser load failed:", { cacheKey, error });
    throw new CompilationError(
      `Failed to load MDX in browser: ${error instanceof Error ? error.message : String(error)}`,
      { cacheKey },
    );
  }
}

/**
 * Wraps compiled MDX code for browser ESM import.
 * Uses import maps to resolve React from CDN.
 */
function wrapForBrowser(compiledCode: string): string {
  // For browser, React should come from import map or CDN
  // This assumes React is available globally or via import map
  const imports = `
// React should be available via import map
import * as React from 'react';
import { jsx, jsxs, Fragment } from 'react/jsx-runtime';

// Make available for compiled MDX
const _jsx = jsx;
const _jsxs = jsxs;
const _jsxDEV = jsx;
const _Fragment = Fragment;
`.trim();

  return `${imports}\n\n${compiledCode}`;
}

/**
 * Clears browser MDX module cache.
 */
export function clearBrowserMDXCache(): void {
  browserMDXCache.clear();
}

/**
 * Check if we're in a browser environment.
 */
export function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}
