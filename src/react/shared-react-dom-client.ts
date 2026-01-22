/**
 * Shared ReactDOM client facade for cross-runtime support.
 *
 * This module provides a unified react-dom/client import that works across all runtimes.
 * It ensures the same React instance is used as shared-react.ts.
 *
 * @module react/shared-react-dom-client
 */

import { isBun, isDeno, isNode } from "../platform/compat/runtime.ts";
import { cacheModuleToLocal } from "../transforms/esm/http-cache.ts";
import { getHttpBundleCacheDir } from "../utils/cache-dir.ts";
import { getReactUrls } from "../transforms/esm/package-registry.ts";

type ReactDOMClientType = typeof import("react-dom/client");

// Internal cache to ensure single instance
let reactDOMClientCache: ReactDOMClientType | null = null;

/**
 * Load ReactDOM client, caching from esm.sh if needed.
 */
async function loadReactDOMClient(): Promise<ReactDOMClientType> {
  if (reactDOMClientCache) {
    return reactDOMClientCache;
  }

  // Node/Bun with node_modules: try native resolution first
  if ((isNode || isBun) && !isDeno) {
    try {
      const nativeReactDOMClient = await import("react-dom/client");
      reactDOMClientCache = nativeReactDOMClient as ReactDOMClientType;
      return reactDOMClientCache;
    } catch {
      // Fall through to esm.sh caching
    }
  }

  const urls = getReactUrls();

  // Deno: use HTTP imports directly (Deno supports them natively)
  if (isDeno) {
    const httpReactDOMClient = await import(urls["react-dom/client"]);
    reactDOMClientCache = httpReactDOMClient as ReactDOMClientType;
    return reactDOMClientCache;
  }

  // Node/Bun without node_modules: cache from esm.sh to local file://
  const cacheDir = getHttpBundleCacheDir();
  const cachedPath = await cacheModuleToLocal(urls["react-dom/client"], cacheDir);
  const cachedReactDOMClient = await import(cachedPath);
  reactDOMClientCache = cachedReactDOMClient as ReactDOMClientType;
  return reactDOMClientCache;
}

// Top-level await - caches at module load
const reactDOMClient = await loadReactDOMClient();

// deno-lint-ignore no-explicit-any
type Any = any;

// Re-export the whole module as default for `import ReactDOM from "react-dom/client"` style
export default reactDOMClient;

// Named exports with explicit type annotations to avoid circular type inference
export const createRoot = reactDOMClient.createRoot as Any;
export const hydrateRoot = reactDOMClient.hydrateRoot as Any;

// Re-export types for TypeScript consumers
export type { Container, Root, RootOptions } from "https://esm.sh/@types/react-dom@18.3.7/client";
