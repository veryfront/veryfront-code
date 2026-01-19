/**
 * Shared React facade for cross-runtime support.
 *
 * This module provides a unified React import that works across all runtimes:
 * - Deno: Caches React from esm.sh to file:// at module load
 * - Node/Bun: Uses native resolution (node_modules) if available, falls back to cache
 *
 * By using this facade, all code shares the same React instance, preventing the
 * "Invalid hook call" error caused by multiple React instances.
 *
 * @module react/shared-react
 */

import { isDeno, isBun, isNode } from "../platform/compat/runtime.ts";
import { cacheModuleToLocal } from "../transforms/esm/http-cache.ts";
import { getHttpBundleCacheDir } from "../utils/cache-dir.ts";
import { getReactUrls } from "../transforms/esm/package-registry.ts";

type ReactType = typeof import("react");

// Internal cache to ensure single instance
let reactCache: ReactType | null = null;

/**
 * Load React, caching from esm.sh if needed.
 */
async function loadReact(): Promise<ReactType> {
  if (reactCache) {
    return reactCache;
  }

  // Node/Bun with node_modules: try native resolution first
  if ((isNode || isBun) && !isDeno) {
    try {
      // Dynamic import to avoid static analysis issues
      const nativeReact = await import("react");
      const mod = nativeReact.default ?? nativeReact;
      reactCache = mod as ReactType;
      return reactCache;
    } catch {
      // Fall through to esm.sh caching
    }
  }

  // Deno or no node_modules: cache from esm.sh
  const urls = getReactUrls();
  const cacheDir = getHttpBundleCacheDir();
  const cachedPath = await cacheModuleToLocal(urls.react, cacheDir);
  const cachedReact = await import(cachedPath);
  const mod = cachedReact.default ?? cachedReact;
  reactCache = mod as ReactType;
  return reactCache;
}

// Top-level await - caches at module load
const React = await loadReact();

// Re-export everything from React
export default React;

// deno-lint-ignore no-explicit-any
type Any = any;

// Named exports for tree-shaking support
// Use explicit type annotations to avoid circular type inference
export const Children = React.Children as Any;
export const Component = React.Component as Any;
export const Fragment = React.Fragment as Any;
export const Profiler = React.Profiler as Any;
export const PureComponent = React.PureComponent as Any;
export const StrictMode = React.StrictMode as Any;
export const Suspense = React.Suspense as Any;
export const cloneElement = React.cloneElement as Any;
export const createContext = React.createContext as Any;
export const createElement = React.createElement as Any;
export const createRef = React.createRef as Any;
export const forwardRef = React.forwardRef as Any;
export const isValidElement = React.isValidElement as Any;
export const lazy = React.lazy as Any;
export const memo = React.memo as Any;
export const startTransition = React.startTransition as Any;
export const useCallback = React.useCallback as Any;
export const useContext = React.useContext as Any;
export const useDebugValue = React.useDebugValue as Any;
export const useDeferredValue = React.useDeferredValue as Any;
export const useEffect = React.useEffect as Any;
export const useId = React.useId as Any;
export const useImperativeHandle = React.useImperativeHandle as Any;
export const useInsertionEffect = React.useInsertionEffect as Any;
export const useLayoutEffect = React.useLayoutEffect as Any;
export const useMemo = React.useMemo as Any;
export const useReducer = React.useReducer as Any;
export const useRef = React.useRef as Any;
export const useState = React.useState as Any;
export const useSyncExternalStore = React.useSyncExternalStore as Any;
export const useTransition = React.useTransition as Any;
export const version = React.version as Any;

// Re-export types from esm.sh directly (avoid circular import via import map)
// This ensures TypeScript can resolve types when "react" points to this module
export type {
  ComponentProps,
  ComponentType,
  FC,
  JSX,
  PropsWithChildren,
  ReactElement,
  ReactNode,
  RefObject,
} from "https://esm.sh/@types/react@18.3.27";
