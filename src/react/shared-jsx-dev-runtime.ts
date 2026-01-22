/**
 * Shared JSX dev runtime facade for cross-runtime support.
 *
 * This module provides a unified react/jsx-dev-runtime import that works across all runtimes.
 * It ensures the same React instance is used as shared-react.ts.
 *
 * @module react/shared-jsx-dev-runtime
 */

import { isBun, isDeno, isNode } from "../platform/compat/runtime.ts";
import { cacheModuleToLocal } from "../transforms/esm/http-cache.ts";
import { getHttpBundleCacheDir } from "../utils/cache-dir.ts";
import { getReactUrls } from "../transforms/esm/package-registry.ts";

type JsxDevRuntimeType = typeof import("react/jsx-dev-runtime");

// Internal cache to ensure single instance
let jsxDevRuntimeCache: JsxDevRuntimeType | null = null;

/**
 * Load JSX dev runtime, caching from esm.sh if needed.
 */
async function loadJsxDevRuntime(): Promise<JsxDevRuntimeType> {
  if (jsxDevRuntimeCache) {
    return jsxDevRuntimeCache;
  }

  // Node/Bun with node_modules: try native resolution first
  if ((isNode || isBun) && !isDeno) {
    try {
      const nativeJsxDevRuntime = await import("react/jsx-dev-runtime");
      jsxDevRuntimeCache = nativeJsxDevRuntime as JsxDevRuntimeType;
      return jsxDevRuntimeCache;
    } catch {
      // Fall through to esm.sh caching
    }
  }

  const urls = getReactUrls();

  // Deno: use HTTP imports directly (Deno supports them natively)
  if (isDeno) {
    const httpJsxDevRuntime = await import(urls["react/jsx-dev-runtime"]);
    jsxDevRuntimeCache = httpJsxDevRuntime as JsxDevRuntimeType;
    return jsxDevRuntimeCache;
  }

  // Node/Bun without node_modules: cache from esm.sh to local file://
  const cacheDir = getHttpBundleCacheDir();
  const cachedPath = await cacheModuleToLocal(urls["react/jsx-dev-runtime"], cacheDir);
  const cachedJsxDevRuntime = await import(cachedPath);
  jsxDevRuntimeCache = cachedJsxDevRuntime as JsxDevRuntimeType;
  return jsxDevRuntimeCache;
}

// Top-level await - caches at module load
const jsxDevRuntime = await loadJsxDevRuntime();

// deno-lint-ignore no-explicit-any
type Any = any;

// Named exports with explicit type annotations to avoid circular type inference
export const jsxDEV = jsxDevRuntime.jsxDEV as Any;
export const Fragment = jsxDevRuntime.Fragment as Any;
