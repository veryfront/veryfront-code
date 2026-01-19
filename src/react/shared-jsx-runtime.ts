/**
 * Shared JSX runtime facade for cross-runtime support.
 *
 * This module provides a unified react/jsx-runtime import that works across all runtimes.
 * It ensures the same React instance is used as shared-react.ts.
 *
 * @module react/shared-jsx-runtime
 */

import { isDeno, isBun, isNode } from "../platform/compat/runtime.ts";
import { cacheModuleToLocal } from "../transforms/esm/http-cache.ts";
import { getHttpBundleCacheDir } from "../utils/cache-dir.ts";
import { getReactUrls } from "../transforms/esm/package-registry.ts";

type JsxRuntimeType = typeof import("react/jsx-runtime");

// Internal cache to ensure single instance
let jsxRuntimeCache: JsxRuntimeType | null = null;

/**
 * Load JSX runtime, caching from esm.sh if needed.
 */
async function loadJsxRuntime(): Promise<JsxRuntimeType> {
  if (jsxRuntimeCache) {
    return jsxRuntimeCache;
  }

  // Node/Bun with node_modules: try native resolution first
  if ((isNode || isBun) && !isDeno) {
    try {
      const nativeJsxRuntime = await import("react/jsx-runtime");
      jsxRuntimeCache = nativeJsxRuntime as JsxRuntimeType;
      return jsxRuntimeCache;
    } catch {
      // Fall through to esm.sh caching
    }
  }

  // Deno or no node_modules: cache from esm.sh
  const urls = getReactUrls();
  const cacheDir = getHttpBundleCacheDir();
  const cachedPath = await cacheModuleToLocal(urls["react/jsx-runtime"], cacheDir);
  const cachedJsxRuntime = await import(cachedPath);
  jsxRuntimeCache = cachedJsxRuntime as JsxRuntimeType;
  return jsxRuntimeCache;
}

// Top-level await - caches at module load
const jsxRuntime = await loadJsxRuntime();

// deno-lint-ignore no-explicit-any
type Any = any;

// Named exports with explicit type annotations to avoid circular type inference
export const jsx = jsxRuntime.jsx as Any;
export const jsxs = jsxRuntime.jsxs as Any;
export const Fragment = jsxRuntime.Fragment as Any;
