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
import { getReactUrls } from "../transforms/esm/package-registry.ts";
import { getHttpBundleCacheDir } from "../utils/cache-dir.ts";

type ReactDOMType = typeof import("react-dom");

let reactDOMCache: ReactDOMType | null = null;

async function loadReactDOM(): Promise<ReactDOMType> {
  if (reactDOMCache) return reactDOMCache;

  const urls = getReactUrls();

  if (isDeno) {
    const httpReactDOM = await import(urls["react-dom"]);
    reactDOMCache = (httpReactDOM.default ?? httpReactDOM) as ReactDOMType;
    return reactDOMCache;
  }

  if (isNode || isBun) {
    try {
      const nativeReactDOM = await import("react-dom");
      reactDOMCache = (nativeReactDOM.default ?? nativeReactDOM) as ReactDOMType;
      return reactDOMCache;
    } catch {
      // Fall through to esm.sh caching
    }
  }

  const cacheDir = getHttpBundleCacheDir();
  const cachedPath = await cacheModuleToLocal(urls["react-dom"], cacheDir);
  const cachedReactDOM = await import(cachedPath);
  reactDOMCache = (cachedReactDOM.default ?? cachedReactDOM) as ReactDOMType;
  return reactDOMCache;
}

const ReactDOM = await loadReactDOM();

export default ReactDOM;

// deno-lint-ignore no-explicit-any
type Any = any;

export const createPortal = ReactDOM.createPortal as Any;
export const flushSync = ReactDOM.flushSync as Any;
export const version = ReactDOM.version as Any;
