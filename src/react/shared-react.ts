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

import type * as ReactTypes from "https://esm.sh/@types/react@18.3.27";

type ReactType = typeof import("react");

let reactCache: ReactType | null = null;

function getDefaultExport<T>(mod: T): T {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((mod as any).default ?? mod) as T;
}

async function loadReact(): Promise<ReactType> {
  if (reactCache) return reactCache;

  // For Node/Bun: use native npm React package
  if (isNode || isBun) {
    try {
      // Use indirect import to avoid dnt transformation
      const reactPkg = "react";
      const nativeReact = await import(/* @vite-ignore */ reactPkg);
      reactCache = getDefaultExport(nativeReact) as ReactType;
      return reactCache;
    } catch {
      // Fall through to esm.sh
    }
  }

  // For Deno: use esm.sh directly
  if (isDeno) {
    const { getReactUrls } = await import("../transforms/esm/package-registry.ts");
    const reactUrl = getReactUrls().react!;
    const httpReact = await import(reactUrl);
    reactCache = getDefaultExport(httpReact) as ReactType;
    return reactCache;
  }

  // Fallback: cache esm.sh module locally
  const { cacheModuleToLocal } = await import("../transforms/esm/http-cache.ts");
  const { getReactUrls } = await import("../transforms/esm/package-registry.ts");
  const { getHttpBundleCacheDir } = await import("../utils/cache-dir.ts");
  const reactUrl = getReactUrls().react!;
  const cacheDir = getHttpBundleCacheDir();
  const cachedPath = await cacheModuleToLocal(reactUrl, cacheDir);
  const cachedReact = await import(cachedPath);
  reactCache = getDefaultExport(cachedReact) as ReactType;
  return reactCache;
}

const React = await loadReact();

export default React;

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

export type {
  AnchorHTMLAttributes,
  Attributes,
  ButtonHTMLAttributes,
  ChangeEvent,
  ClassAttributes,
  ComponentClass,
  ComponentProps,
  ComponentPropsWithoutRef,
  ComponentPropsWithRef,
  ComponentType,
  Consumer,
  Context,
  CSSProperties,
  DependencyList,
  DetailedHTMLProps,
  Dispatch,
  EffectCallback,
  ErrorInfo,
  FC,
  FormEvent,
  FormHTMLAttributes,
  FunctionComponent,
  HTMLAttributes,
  ImgHTMLAttributes,
  InputHTMLAttributes,
  JSXElementConstructor,
  Key,
  KeyboardEvent,
  LegacyRef,
  MouseEvent,
  MutableRefObject,
  PointerEvent,
  PropsWithChildren,
  PropsWithRef,
  Provider,
  ReactElement,
  ReactNode,
  Reducer,
  ReducerAction,
  ReducerState,
  Ref,
  RefAttributes,
  RefCallback,
  RefObject,
  SetStateAction,
  SourceHTMLAttributes,
  SyntheticEvent,
  TextareaHTMLAttributes,
  TouchEvent,
  UIEvent,
  WheelEvent,
} from "https://esm.sh/@types/react@18.3.27";

export type { JSX } from "https://esm.sh/@types/react@18.3.27";
