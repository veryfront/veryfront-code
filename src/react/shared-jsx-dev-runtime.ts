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
import { getReactUrls } from "../transforms/esm/package-registry.ts";
import { getHttpBundleCacheDir } from "../utils/cache-dir.ts";

type JsxDevRuntimeType = typeof import("react/jsx-dev-runtime");

let jsxDevRuntimeCache: JsxDevRuntimeType | null = null;

async function loadJsxDevRuntime(): Promise<JsxDevRuntimeType> {
  if (jsxDevRuntimeCache) return jsxDevRuntimeCache;

  const urls = getReactUrls();
  const url = urls["react/jsx-dev-runtime"];

  if (isDeno) {
    jsxDevRuntimeCache = (await import(url)) as JsxDevRuntimeType;
    return jsxDevRuntimeCache;
  }

  if ((isNode || isBun) && !isDeno) {
    try {
      jsxDevRuntimeCache = (await import("react/jsx-dev-runtime")) as JsxDevRuntimeType;
      return jsxDevRuntimeCache;
    } catch {
      // Fall through to esm.sh caching
    }
  }

  const cacheDir = getHttpBundleCacheDir();
  const cachedPath = await cacheModuleToLocal(url, cacheDir);
  jsxDevRuntimeCache = (await import(cachedPath)) as JsxDevRuntimeType;
  return jsxDevRuntimeCache;
}

const jsxDevRuntime = await loadJsxDevRuntime();

// deno-lint-ignore no-explicit-any
type Any = any;

export const jsxDEV = jsxDevRuntime.jsxDEV as Any;
export const Fragment = jsxDevRuntime.Fragment as Any;
