/**
 * MDX module loading and caching functionality.
 * Securely loads MDX modules using ESM dynamic imports instead of eval/new Function.
 * @module
 */

import type * as React from "react";
import { getCacheNamespace } from "@veryfront/utils/cache/keys/namespace.ts";
import { CompilationError, wrapError } from "@veryfront/errors/index.ts";
import { getAdapter } from "@veryfront/platform/adapters/index.ts";
import { rendererLogger as logger } from "@veryfront/utils";
import type { MDXModule } from "./types.ts";

/**
 * Cache for loaded MDX modules keyed by namespace and module path.
 */
const mdxModuleCache = new Map<string, MDXModule>();

/**
 * Clears all cached MDX modules.
 * Useful for development mode when modules need to be reloaded.
 */
export function clearMDXModuleCache(): void {
  mdxModuleCache.clear();
}

/**
 * Loads an MDX module from the given path with caching support.
 *
 * @param modulePath - Absolute path to the MDX module
 * @param _components - Optional custom components (currently unused, reserved for future use)
 * @returns Promise resolving to the loaded MDX module
 * @throws {CompilationError} If the module has no default export
 * @throws {Error} If the module fails to load
 *
 * @example
 * ```ts
 * const module = await loadMDXModule('/path/to/page.mdx')
 * const Component = module.default || module.MDXContent
 * ```
 */
export async function loadMDXModule(
  modulePath: string,
  _components: Record<string, React.ComponentType<unknown>> = {},
): Promise<MDXModule> {
  try {
    const ns = getCacheNamespace() || "default";
    const key = `${ns}:${modulePath}`;
    const cached = mdxModuleCache.get(key);
    if (cached) {
      return cached;
    }

    const module = await import(modulePath) as MDXModule;

    const MDXContent = module.default || module.MDXContent;

    if (!MDXContent) {
      throw new CompilationError("No default export found in MDX module", {
        modulePath,
      });
    }

    mdxModuleCache.set(key, module);

    return module;
  } catch (error) {
    throw wrapError(error, `Failed to load MDX module: ${modulePath}`, { modulePath });
  }
}

/**
 * Loads compiled MDX code as an ESM module using dynamic import.
 * This is the SECURE alternative to new Function() or eval().
 *
 * Auto-detects environment and uses appropriate method:
 * - Server (Deno/Node): Writes to temp file, imports, cleans up
 * - Browser: Uses Blob URL for dynamic import
 *
 * @param compiledCode - The compiled MDX JavaScript code (as ESM module)
 * @param cacheKey - Unique identifier for caching (e.g., file path or content hash)
 * @returns Promise resolving to the loaded MDX module
 *
 * @example
 * ```ts
 * const module = await loadCompiledMDXModule(compiledCode, 'blog-post-123')
 * const Component = module.default
 * ```
 */
export async function loadCompiledMDXModule(
  compiledCode: string,
  cacheKey: string,
): Promise<MDXModule> {
  try {
    const ns = getCacheNamespace() || "default";
    const key = `${ns}:compiled:${cacheKey}`;
    const cached = mdxModuleCache.get(key);
    if (cached) {
      return cached;
    }

    // Auto-detect environment and use appropriate loader
    const isBrowser = typeof window !== "undefined" && typeof document !== "undefined";

    if (isBrowser) {
      // Browser: Use Blob URL
      return await loadViaBlobURL(compiledCode, cacheKey, key);
    } else {
      // Server: Use temp file
      return await loadViaTempFile(compiledCode, cacheKey, key);
    }
  } catch (error) {
    throw wrapError(error, `Failed to load compiled MDX module`, { cacheKey });
  }
}

/**
 * Server-side loader: writes to temp file and imports.
 */
async function loadViaTempFile(
  compiledCode: string,
  cacheKey: string,
  key: string,
): Promise<MDXModule> {
  const tempModulePath = await writeTempMDXModule(compiledCode, cacheKey);

  try {
    const module = await import(tempModulePath) as MDXModule;

    const MDXContent = module.default || module.MDXContent;

    if (!MDXContent) {
      throw new CompilationError("No default export found in compiled MDX", {
        cacheKey,
        codePreview: compiledCode.substring(0, 200),
      });
    }

    mdxModuleCache.set(key, module);

    return module;
  } finally {
    // Clean up temp file asynchronously (don't block)
    cleanupTempModule(tempModulePath).catch((err) =>
      logger.debug("[MDX] Failed to cleanup temp module:", err)
    );
  }
}

/**
 * Browser-side loader: uses Blob URL for dynamic import.
 */
async function loadViaBlobURL(
  compiledCode: string,
  cacheKey: string,
  key: string,
): Promise<MDXModule> {
  const moduleCode = wrapAsESMModule(compiledCode);

  // Create Blob URL (browser-only feature)
  const blob = new Blob([moduleCode], { type: "application/javascript" });
  const blobURL = URL.createObjectURL(blob);

  try {
    const module = await import(blobURL) as MDXModule;

    const MDXContent = module.default || module.MDXContent;

    if (!MDXContent) {
      throw new CompilationError("No default export found in compiled MDX", {
        cacheKey,
        codePreview: compiledCode.substring(0, 200),
      });
    }

    mdxModuleCache.set(key, module);

    return module;
  } finally {
    // Revoke Blob URL to free memory
    URL.revokeObjectURL(blobURL);
  }
}

/**
 * Writes compiled MDX code to a temporary .mjs file for ESM import.
 */
async function writeTempMDXModule(
  compiledCode: string,
  cacheKey: string,
): Promise<string> {
  const adapter = await getAdapter();
  const tempDir = await ensureTempDir();

  // Generate unique filename
  const safeKey = cacheKey.replace(/[^a-zA-Z0-9-_]/g, "_").substring(0, 50);
  const filename = `mdx-${safeKey}-${Date.now()}.mjs`;
  const modulePath = `${tempDir}/${filename}`;

  // Wrap code in proper ESM format with React imports
  const moduleCode = wrapAsESMModule(compiledCode);

  await adapter.fs.writeFile(modulePath, moduleCode);

  return modulePath;
}

/**
 * Wraps compiled MDX code in proper ESM module format.
 */
function wrapAsESMModule(compiledCode: string): string {
  // Add ESM imports for React and JSX runtime
  const imports = `
import * as React from 'react';
import { jsx, jsxs, Fragment } from 'react/jsx-runtime';

// Make React globals available for compiled MDX
const _jsx = jsx;
const _jsxs = jsxs;
const _jsxDEV = jsx;
const _Fragment = Fragment;
`.trim();

  return `${imports}\n\n${compiledCode}`;
}

/**
 * Ensures temp directory exists for MDX modules.
 */
async function ensureTempDir(): Promise<string> {
  const adapter = await getAdapter();
  const tempDir = `${Deno.cwd()}/.veryfront/temp/mdx-modules`;

  try {
    const exists = await adapter.fs.exists(tempDir);
    if (!exists) {
      await adapter.fs.mkdir(tempDir, { recursive: true });
    }
    return tempDir;
  } catch (error) {
    logger.warn("[MDX] Failed to create temp directory, using system temp:", error);
    return Deno.makeTempDirSync({ prefix: "veryfront-mdx-" });
  }
}

/**
 * Cleans up temporary module file (best-effort, non-blocking).
 */
async function cleanupTempModule(modulePath: string): Promise<void> {
  try {
    const adapter = await getAdapter();
    await adapter.fs.remove(modulePath);
  } catch {
    // Cleanup is best-effort, silent failure is OK
  }
}
