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

import { isBun, isDeno, isNode } from "../platform/compat/runtime.ts";
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

// Import types from @types/react for proper type annotations
import type * as ReactTypes from "https://esm.sh/@types/react@19";

// Named exports for tree-shaking support
// Explicitly typed to preserve React's generic type signatures
export const Children: typeof ReactTypes.Children = React.Children;
export const Component: typeof ReactTypes.Component = React.Component;
export const Fragment: ReactTypes.ExoticComponent<{ children?: ReactTypes.ReactNode }> =
  React.Fragment;
export const Profiler: typeof ReactTypes.Profiler = React.Profiler;
export const PureComponent: typeof ReactTypes.PureComponent = React.PureComponent;
export const StrictMode: ReactTypes.ExoticComponent<{ children?: ReactTypes.ReactNode }> =
  React.StrictMode;
export const Suspense: typeof ReactTypes.Suspense = React.Suspense;
export const cloneElement: typeof ReactTypes.cloneElement = React.cloneElement;
export const createContext: typeof ReactTypes.createContext = React.createContext;
export const createElement: typeof ReactTypes.createElement = React.createElement;
export const createRef: typeof ReactTypes.createRef = React.createRef;
export const forwardRef: typeof ReactTypes.forwardRef = React.forwardRef;
export const isValidElement: typeof ReactTypes.isValidElement = React.isValidElement;
export const lazy: typeof ReactTypes.lazy = React.lazy;
export const memo: typeof ReactTypes.memo = React.memo;
export const startTransition: typeof ReactTypes.startTransition = React.startTransition;
export const useCallback: typeof ReactTypes.useCallback = React.useCallback;
export const useContext: typeof ReactTypes.useContext = React.useContext;
export const useDebugValue: typeof ReactTypes.useDebugValue = React.useDebugValue;
export const useDeferredValue: typeof ReactTypes.useDeferredValue = React.useDeferredValue;
export const useEffect: typeof ReactTypes.useEffect = React.useEffect;
export const useId: typeof ReactTypes.useId = React.useId;
export const useImperativeHandle: typeof ReactTypes.useImperativeHandle = React.useImperativeHandle;
export const useInsertionEffect: typeof ReactTypes.useInsertionEffect = React.useInsertionEffect;
export const useLayoutEffect: typeof ReactTypes.useLayoutEffect = React.useLayoutEffect;
export const useMemo: typeof ReactTypes.useMemo = React.useMemo;
export const useReducer: typeof ReactTypes.useReducer = React.useReducer;
export const useRef: typeof ReactTypes.useRef = React.useRef;
export const useState: typeof ReactTypes.useState = React.useState;
export const useSyncExternalStore: typeof ReactTypes.useSyncExternalStore =
  React.useSyncExternalStore;
export const useTransition: typeof ReactTypes.useTransition = React.useTransition;
export const version: string = React.version;

// Re-export types from esm.sh directly (avoid circular import via import map)
// This ensures TypeScript can resolve types when "react" points to this module
export type {
  ComponentClass,
  ComponentProps,
  ComponentType,
  Consumer,
  Context,
  CSSProperties,
  DependencyList,
  Dispatch,
  EffectCallback,
  ErrorInfo,
  FC,
  FunctionComponent,
  JSX,
  JSXElementConstructor,
  Key,
  LegacyRef,
  MutableRefObject,
  PropsWithChildren,
  PropsWithRef,
  Provider,
  ReactChild,
  ReactElement,
  ReactFragment,
  ReactNode,
  ReactPortal,
  ReactText,
  Ref,
  RefCallback,
  RefObject,
  SetStateAction,
} from "https://esm.sh/@types/react@18.3.27";
