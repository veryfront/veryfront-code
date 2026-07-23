import type { ComponentType } from "react";
import { COMPONENT_LOADER_MAX_ENTRIES } from "#veryfront/utils/constants/cache.ts";
import { pathToModuleUrl } from "./path-utils.ts";

const MAX_CONCURRENT_COMPONENT_LOADS = 64;
const MAX_QUEUED_COMPONENT_LOADS = COMPONENT_LOADER_MAX_ENTRIES;
const MAX_TRACKED_COMPONENT_LOADS = MAX_CONCURRENT_COMPONENT_LOADS + MAX_QUEUED_COMPONENT_LOADS;
const REACT_COMPONENT_SYMBOLS = new Set([
  Symbol.for("react.forward_ref"),
  Symbol.for("react.lazy"),
  Symbol.for("react.memo"),
]);

const componentCache = new Map<string, ComponentType<unknown>>();
const loadingPromises = new Map<string, Promise<ComponentType<unknown> | null>>();
let cacheGeneration: object = {};
let activeComponentLoads = 0;
let saturationWarningEmitted = false;

interface ComponentLoadWaiter {
  generation: object;
  resolve: (acquired: boolean | null) => void;
}

const componentLoadQueue: ComponentLoadWaiter[] = [];

/** Explicit module resolution context for one component load. */
export interface ComponentLoadOptions {
  /** Release asset map to use instead of mutable browser-global state. */
  releaseAssetModules?: Record<string, string> | null;
  /** Release id to use for fallback module URL versioning. */
  releaseId?: string | null;
}

interface ComponentResolutionContext {
  releaseAssetModules: Record<string, string> | null | undefined;
  releaseId: string | null | undefined;
}

function getComponentResolutionContext(
  options: ComponentLoadOptions | undefined,
): ComponentResolutionContext {
  if (!options) return { releaseAssetModules: undefined, releaseId: undefined };
  const readDataProperty = (key: keyof ComponentLoadOptions): unknown => {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(options, key);
    } catch {
      throw new TypeError("Component load options cannot be inspected");
    }
    if (!descriptor) return undefined;
    if (descriptor.get || descriptor.set || !("value" in descriptor)) {
      throw new TypeError("Component load options cannot be inspected");
    }
    return descriptor.value;
  };
  return {
    releaseAssetModules: readDataProperty("releaseAssetModules") as
      | Record<string, string>
      | null
      | undefined,
    releaseId: readDataProperty("releaseId") as string | null | undefined,
  };
}

function resolveComponentModuleUrl(
  path: string,
  options: ComponentLoadOptions | undefined,
): string {
  const context = getComponentResolutionContext(options);
  return pathToModuleUrl(
    path,
    undefined,
    context.releaseAssetModules,
    context.releaseId,
  );
}

function acquireComponentLoad(generation: object): Promise<boolean | null> {
  if (activeComponentLoads < MAX_CONCURRENT_COMPONENT_LOADS) {
    activeComponentLoads++;
    return Promise.resolve(true);
  }
  if (componentLoadQueue.length >= MAX_QUEUED_COMPONENT_LOADS) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => componentLoadQueue.push({ generation, resolve }));
}

function releaseComponentLoad(): void {
  activeComponentLoads--;
  while (componentLoadQueue.length > 0) {
    const waiter = componentLoadQueue.shift()!;
    if (waiter.generation !== cacheGeneration) {
      waiter.resolve(false);
      continue;
    }
    activeComponentLoads++;
    waiter.resolve(true);
    return;
  }
}

function invalidateQueuedComponentLoads(): void {
  for (const waiter of componentLoadQueue.splice(0)) waiter.resolve(false);
  saturationWarningEmitted = false;
}

function reportComponentLoadSaturation(): void {
  if (saturationWarningEmitted) return;
  saturationWarningEmitted = true;
  console.error("[Veryfront] Component load queue limit reached");
}

function resetSaturationWarningWhenCapacityReturns(): void {
  if (
    componentLoadQueue.length < MAX_QUEUED_COMPONENT_LOADS &&
    loadingPromises.size < MAX_TRACKED_COMPONENT_LOADS
  ) {
    saturationWarningEmitted = false;
  }
}

function isComponentType(value: unknown): value is ComponentType<unknown> {
  if (typeof value === "function") return true;
  if (typeof value !== "object" || value === null) return false;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, "$$typeof");
    if (!descriptor || descriptor.get || descriptor.set || !("value" in descriptor)) return false;
    return typeof descriptor.value === "symbol" && REACT_COMPONENT_SYMBOLS.has(descriptor.value);
  } catch {
    return false;
  }
}

function getSafeErrorName(error: unknown): string {
  try {
    if (error instanceof TypeError) return "TypeError";
    if (error instanceof SyntaxError) return "SyntaxError";
    if (error instanceof ReferenceError) return "ReferenceError";
    if (error instanceof RangeError) return "RangeError";
    return error instanceof Error ? "Error" : "UnknownError";
  } catch {
    return "UnknownError";
  }
}

function usesContentLayoutExport(path: string): boolean {
  return /\.mdx?(?:[?#].*)?$/.test(path);
}

function getComponentCacheKey(moduleUrl: string, path: string): string {
  return `${usesContentLayoutExport(path) ? "content-layout" : "default"}:${moduleUrl}`;
}

function selectComponentExport(module: Record<string, unknown>, path: string): unknown {
  if (usesContentLayoutExport(path)) {
    return module.MDXLayout ?? module.MainLayout ?? module.default;
  }
  return module.default;
}

function getCachedByKey(cacheKey: string): ComponentType<unknown> | null {
  const cached = componentCache.get(cacheKey);
  if (!cached) return null;
  componentCache.delete(cacheKey);
  componentCache.set(cacheKey, cached);
  return cached;
}

function cacheComponent(cacheKey: string, component: ComponentType<unknown>): void {
  componentCache.delete(cacheKey);
  componentCache.set(cacheKey, component);
  while (componentCache.size > COMPONENT_LOADER_MAX_ENTRIES) {
    const oldestKey = componentCache.keys().next().value;
    if (typeof oldestKey !== "string") break;
    componentCache.delete(oldestKey);
  }
}

/** Load and cache the React component export selected for a page or layout module. */
export function loadComponent(
  path: string,
  options?: ComponentLoadOptions,
): Promise<ComponentType<unknown> | null> {
  if (!path) return Promise.resolve(null);

  let moduleUrl: string;
  try {
    moduleUrl = resolveComponentModuleUrl(path, options);
  } catch (error) {
    const errorName = getSafeErrorName(error);
    console.error(`[Veryfront] Component resolution failed (${errorName})`);
    return Promise.resolve(null);
  }
  const cacheKey = getComponentCacheKey(moduleUrl, path);

  const cached = getCachedByKey(cacheKey);
  if (cached) return Promise.resolve(cached);

  const existingPromise = loadingPromises.get(cacheKey);
  if (existingPromise) return existingPromise;
  if (loadingPromises.size >= MAX_TRACKED_COMPONENT_LOADS) {
    reportComponentLoadSaturation();
    return Promise.resolve(null);
  }
  const generation = cacheGeneration;
  const loadPromise = (async (): Promise<ComponentType<unknown> | null> => {
    let acquired = false;
    try {
      const permit = await acquireComponentLoad(generation);
      if (permit === null) {
        reportComponentLoadSaturation();
        return null;
      }
      if (!permit) return null;
      acquired = true;
      if (generation !== cacheGeneration) return null;

      const module = await import(/* @vite-ignore */ moduleUrl);
      const Component = selectComponentExport(module, path);
      if (!isComponentType(Component)) {
        throw new TypeError("Component module must export a React component");
      }

      if (generation !== cacheGeneration) return null;
      cacheComponent(cacheKey, Component);
      return Component;
    } catch (error) {
      const errorName = getSafeErrorName(error);
      console.error(`[Veryfront] Component load failed (${errorName})`);
      return null;
    } finally {
      if (acquired) releaseComponentLoad();
      if (generation === cacheGeneration) loadingPromises.delete(cacheKey);
      resetSaturationWarningWhenCapacityReturns();
    }
  })();

  loadingPromises.set(cacheKey, loadPromise);
  return loadPromise;
}

/** Preload a component into the client cache. */
export async function preloadComponent(
  path: string,
  options?: ComponentLoadOptions,
): Promise<void> {
  await loadComponent(path, options);
}

/** Return a component cached for the path's current resolved module URL. */
export function getCachedComponent(
  path: string,
  options?: ComponentLoadOptions,
): ComponentType<unknown> | null {
  if (!path) return null;
  const moduleUrl = resolveComponentModuleUrl(path, options);
  return getCachedByKey(getComponentCacheKey(moduleUrl, path));
}

/** Invalidate all resolved components and in-flight cache publications. */
export function clearComponentCache(): void {
  cacheGeneration = {};
  componentCache.clear();
  loadingPromises.clear();
  invalidateQueuedComponentLoads();
}

// Expose component loader globally for hydration scripts
if (typeof window !== "undefined") {
  const global = window as unknown as Record<string, unknown>;
  global.__VERYFRONT_LOAD_COMPONENT__ = loadComponent;
  global.__VERYFRONT_PRELOAD_COMPONENT__ = preloadComponent;
  global.__VERYFRONT_GET_CACHED_COMPONENT__ = getCachedComponent;
}
