/**
 * Shared ReactDOM server facade for cross-runtime support.
 *
 * This module provides a unified react-dom/server import that works across all runtimes.
 * It ensures the same React instance is used as shared-react.ts.
 *
 * @module react/shared-react-dom-server
 */

import { isDeno, isBun, isNode } from "../platform/compat/runtime.ts";
import { cacheModuleToLocal } from "../transforms/esm/http-cache.ts";
import { getHttpBundleCacheDir } from "../utils/cache-dir.ts";
import { getReactUrls } from "../transforms/esm/package-registry.ts";

type ReactDOMServerType = typeof import("react-dom/server");

// Internal cache to ensure single instance
let reactDOMServerCache: ReactDOMServerType | null = null;

/**
 * Load ReactDOM server, caching from esm.sh if needed.
 */
async function loadReactDOMServer(): Promise<ReactDOMServerType> {
  if (reactDOMServerCache) {
    return reactDOMServerCache;
  }

  // Node/Bun with node_modules: try native resolution first
  if ((isNode || isBun) && !isDeno) {
    try {
      const nativeReactDOMServer = await import("react-dom/server");
      reactDOMServerCache = nativeReactDOMServer as ReactDOMServerType;
      return reactDOMServerCache;
    } catch {
      // Fall through to esm.sh caching
    }
  }

  // Deno or no node_modules: cache from esm.sh
  const urls = getReactUrls();
  const cacheDir = getHttpBundleCacheDir();
  const cachedPath = await cacheModuleToLocal(urls["react-dom/server"], cacheDir);
  const cachedReactDOMServer = await import(cachedPath);
  reactDOMServerCache = cachedReactDOMServer as ReactDOMServerType;
  return reactDOMServerCache;
}

// Top-level await - caches at module load
const reactDOMServer = await loadReactDOMServer();

// deno-lint-ignore no-explicit-any
type Any = any;

// Named exports with explicit type annotations to avoid circular type inference
export const renderToString = reactDOMServer.renderToString as Any;
export const renderToStaticMarkup = reactDOMServer.renderToStaticMarkup as Any;
export const renderToPipeableStream = reactDOMServer.renderToPipeableStream as Any;
export const renderToReadableStream = reactDOMServer.renderToReadableStream as Any;
export const version = reactDOMServer.version as Any;
