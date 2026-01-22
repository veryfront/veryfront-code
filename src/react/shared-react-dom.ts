/**
 * Shared ReactDOM facade for cross-runtime support.
 *
 * This module provides a unified react-dom import that works across all runtimes.
 * It ensures the same React instance is used as shared-react.ts.
 *
 * @module react/shared-react-dom
 */

import { isBun, isDeno, isNode } from "../platform/compat/runtime.ts";
import { cacheModuleToLocal } from "../transforms/esm/http-cache.ts";
import { getHttpBundleCacheDir } from "../utils/cache-dir.ts";
import { getReactUrls } from "../transforms/esm/package-registry.ts";

type ReactDOMType = typeof import("react-dom");

// Internal cache to ensure single instance
let reactDOMCache: ReactDOMType | null = null;

/**
 * Load ReactDOM, caching from esm.sh if needed.
 */
async function loadReactDOM(): Promise<ReactDOMType> {
  if (reactDOMCache) {
    return reactDOMCache;
  }

  // Node/Bun with node_modules: try native resolution first
  if ((isNode || isBun) && !isDeno) {
    try {
      const nativeReactDOM = await import("react-dom");
      const mod = nativeReactDOM.default ?? nativeReactDOM;
      reactDOMCache = mod as ReactDOMType;
      return reactDOMCache;
    } catch {
      // Fall through to esm.sh caching
    }
  }

  const urls = getReactUrls();

  // Deno: use HTTP imports directly (Deno supports them natively)
  if (isDeno) {
    const httpReactDOM = await import(urls["react-dom"]);
    const mod = httpReactDOM.default ?? httpReactDOM;
    reactDOMCache = mod as ReactDOMType;
    return reactDOMCache;
  }

  // Node/Bun without node_modules: cache from esm.sh to local file://
  const cacheDir = getHttpBundleCacheDir();
  const cachedPath = await cacheModuleToLocal(urls["react-dom"], cacheDir);
  const cachedReactDOM = await import(cachedPath);
  const mod = cachedReactDOM.default ?? cachedReactDOM;
  reactDOMCache = mod as ReactDOMType;
  return reactDOMCache;
}

// Top-level await - caches at module load
const ReactDOM = await loadReactDOM();

// Re-export everything from ReactDOM
export default ReactDOM;

// deno-lint-ignore no-explicit-any
type Any = any;

// Named exports for common APIs with explicit type annotations
export const createPortal = ReactDOM.createPortal as Any;
export const flushSync = ReactDOM.flushSync as Any;
// Note: hydrate/render are deprecated in React 18+, use react-dom/client
export const version = ReactDOM.version as Any;
