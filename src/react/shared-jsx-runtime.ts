/**
 * Shared JSX runtime facade for cross-runtime support.
 *
 * This module provides a unified react/jsx-runtime import that works across all runtimes.
 * It ensures the same React instance is used as shared-react.ts.
 *
 * @module react/shared-jsx-runtime
 */

import { isBun, isDeno, isNode } from "../platform/compat/runtime.ts";
import { cacheModuleToLocal } from "../transforms/esm/http-cache.ts";
import { getReactUrls } from "../transforms/esm/package-registry.ts";
import { getHttpBundleCacheDir } from "../utils/cache-dir.ts";

type JsxRuntimeType = typeof import("react/jsx-runtime");

let jsxRuntimeCache: JsxRuntimeType | null = null;

async function loadJsxRuntime(): Promise<JsxRuntimeType> {
  if (jsxRuntimeCache) return jsxRuntimeCache;

  const urls = getReactUrls();
  const jsxRuntimeUrl = urls["react/jsx-runtime"]!;

  if (isDeno) {
    jsxRuntimeCache = (await import(jsxRuntimeUrl)) as JsxRuntimeType;
    return jsxRuntimeCache;
  }

  if (isNode || isBun) {
    try {
      jsxRuntimeCache = (await import("react/jsx-runtime")) as JsxRuntimeType;
      return jsxRuntimeCache;
    } catch {
      // Fall through to esm.sh caching
    }
  }

  const cacheDir = getHttpBundleCacheDir();
  const cachedPath = await cacheModuleToLocal(jsxRuntimeUrl, cacheDir);
  jsxRuntimeCache = (await import(cachedPath)) as JsxRuntimeType;
  return jsxRuntimeCache;
}

const jsxRuntime = await loadJsxRuntime();

// deno-lint-ignore no-explicit-any
type Any = any;

export const jsx = jsxRuntime.jsx as Any;
export const jsxs = jsxRuntime.jsxs as Any;
export const Fragment = jsxRuntime.Fragment as Any;
