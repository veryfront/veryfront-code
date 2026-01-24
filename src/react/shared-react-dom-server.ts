/**
 * Shared ReactDOM server facade for cross-runtime support.
 *
 * This module provides a unified react-dom/server import that works across all runtimes.
 * It ensures the same React instance is used as shared-react.ts.
 *
 * @module react/shared-react-dom-server
 */

import { isBun, isDeno, isNode } from "../platform/compat/runtime.ts";
import { cacheModuleToLocal } from "../transforms/esm/http-cache.ts";
import { getReactUrls } from "../transforms/esm/package-registry.ts";
import { getHttpBundleCacheDir } from "../utils/cache-dir.ts";

type ReactDOMServerType = typeof import("react-dom/server");

let reactDOMServerCache: ReactDOMServerType | null = null;

async function loadReactDOMServer(): Promise<ReactDOMServerType> {
  if (reactDOMServerCache) return reactDOMServerCache;

  const urls = getReactUrls();
  const url = urls["react-dom/server"]!;

  if (isDeno) {
    reactDOMServerCache = (await import(url)) as ReactDOMServerType;
    return reactDOMServerCache;
  }

  if (isNode || isBun) {
    try {
      reactDOMServerCache = (await import("react-dom/server")) as ReactDOMServerType;
      return reactDOMServerCache;
    } catch {
      // Fall through to esm.sh caching
    }
  }

  const cacheDir = getHttpBundleCacheDir();
  const cachedPath = await cacheModuleToLocal(url, cacheDir);
  reactDOMServerCache = (await import(cachedPath)) as ReactDOMServerType;
  return reactDOMServerCache;
}

const reactDOMServer = await loadReactDOMServer();

// deno-lint-ignore no-explicit-any
type Any = any;

export const renderToString = reactDOMServer.renderToString as Any;
export const renderToStaticMarkup = reactDOMServer.renderToStaticMarkup as Any;
export const renderToPipeableStream = reactDOMServer.renderToPipeableStream as Any;
export const renderToReadableStream = reactDOMServer.renderToReadableStream as Any;
export const version = reactDOMServer.version as Any;
