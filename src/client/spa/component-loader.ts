import type { ComponentType } from "react";
import { pathToModuleUrl } from "./path-utils.ts";

const MAX_COMPONENT_CACHE_SIZE = 500;
const MAX_PENDING_COMPONENT_LOADS = 512;
const MAX_LOGGED_COMPONENT_PATH_LENGTH = 256;
const componentCache = new Map<string, ComponentType<unknown>>();
interface PendingComponentLoad {
  promise: Promise<ComponentType<unknown> | null>;
  token: symbol;
}

const loadingPromises = new Map<string, PendingComponentLoad>();
let cacheGeneration = 0;
// JavaScript runtimes retain failed module loads by URL. A monotonic global
// revision lets a retry bypass that negative entry without retaining one
// failure counter for every attacker- or application-supplied path.
let importRevision = 0;

const REACT_EXOTIC_COMPONENT_TYPES = new Set([
  Symbol.for("react.forward_ref"),
  Symbol.for("react.lazy"),
  Symbol.for("react.memo"),
]);

function isComponentType(value: unknown): value is ComponentType<unknown> {
  if (typeof value === "function") return true;
  if (typeof value !== "object" || value === null) return false;

  try {
    const marker = (value as { $$typeof?: unknown }).$$typeof;
    return typeof marker === "symbol" && REACT_EXOTIC_COMPONENT_TYPES.has(marker);
  } catch {
    return false;
  }
}

function cacheKeyForPath(path: string): string {
  return pathToModuleUrl(path);
}

function readCachedComponent(moduleUrl: string): ComponentType<unknown> | null {
  const cached = componentCache.get(moduleUrl);
  if (!cached) return null;

  // Refresh insertion order so eviction is true LRU rather than FIFO.
  componentCache.delete(moduleUrl);
  componentCache.set(moduleUrl, cached);
  return cached;
}

function storeCachedComponent(
  moduleUrl: string,
  Component: ComponentType<unknown>,
): void {
  componentCache.delete(moduleUrl);
  if (componentCache.size >= MAX_COMPONENT_CACHE_SIZE) {
    const oldestKey = componentCache.keys().next().value;
    if (oldestKey !== undefined) componentCache.delete(oldestKey);
  }
  componentCache.set(moduleUrl, Component);
}

function moduleUrlForAttempt(moduleUrl: string, revision: number, generation: number): string {
  if (revision === 0 && generation === 0) return moduleUrl;

  // A fragment changes module identity without changing the HTTP request, so
  // signed release-asset URLs and their query parameters remain intact.
  const separator = moduleUrl.includes("#") ? "&" : "#";
  return `${moduleUrl}${separator}__veryfront_generation=${generation}&__veryfront_revision=${revision}`;
}

function logLoadFailure(path: string, error: unknown): void {
  const errorName = error instanceof Error ? error.name : "UnknownError";
  const boundedPath = path.length <= MAX_LOGGED_COMPONENT_PATH_LENGTH
    ? path
    : `${path.slice(0, MAX_LOGGED_COMPONENT_PATH_LENGTH - 1)}…`;
  console.error(
    `[Veryfront] Failed to load component: ${JSON.stringify(boundedPath)} (${errorName})`,
  );
}

export function loadComponent(path: string): Promise<ComponentType<unknown> | null> {
  if (!path) return Promise.resolve(null);

  let moduleUrl: string;
  try {
    moduleUrl = cacheKeyForPath(path);
  } catch (error) {
    logLoadFailure(path, error);
    return Promise.resolve(null);
  }
  const cached = readCachedComponent(moduleUrl);
  if (cached) return Promise.resolve(cached);

  const existingLoad = loadingPromises.get(moduleUrl);
  if (existingLoad) return existingLoad.promise;

  if (loadingPromises.size >= MAX_PENDING_COMPONENT_LOADS) {
    logLoadFailure(
      path,
      new RangeError(`At most ${MAX_PENDING_COMPONENT_LOADS} component loads may be in flight`),
    );
    return Promise.resolve(null);
  }

  const generation = cacheGeneration;
  const revision = importRevision;
  const importUrl = moduleUrlForAttempt(moduleUrl, revision, generation);
  const loadToken = Symbol("component-load");
  const loadPromise = (async (): Promise<ComponentType<unknown> | null> => {
    try {
      const module = await import(/* @vite-ignore */ importUrl);
      const Component: unknown = module.default;
      if (!isComponentType(Component)) {
        throw new TypeError("Module does not have a valid default React component export");
      }

      if (
        generation !== cacheGeneration || loadingPromises.get(moduleUrl)?.token !== loadToken
      ) return null;

      storeCachedComponent(moduleUrl, Component);
      return Component;
    } catch (error) {
      if (
        generation === cacheGeneration && loadingPromises.get(moduleUrl)?.token === loadToken
      ) {
        importRevision = Math.max(importRevision, revision + 1);
      }
      logLoadFailure(path, error);
      return null;
    } finally {
      if (loadingPromises.get(moduleUrl)?.token === loadToken) {
        loadingPromises.delete(moduleUrl);
      }
    }
  })();

  loadingPromises.set(moduleUrl, { promise: loadPromise, token: loadToken });
  return loadPromise;
}

export async function preloadComponent(path: string): Promise<void> {
  await loadComponent(path);
}

export function getCachedComponent(path: string): ComponentType<unknown> | null {
  if (!path) return null;
  try {
    return readCachedComponent(cacheKeyForPath(path));
  } catch {
    return null;
  }
}

export function clearComponentCache(): void {
  cacheGeneration++;
  importRevision = 0;
  componentCache.clear();
  loadingPromises.clear();
}

// Expose component loader globally for hydration scripts
if (typeof window !== "undefined") {
  const global = window as unknown as Record<string, unknown>;
  global.__VERYFRONT_LOAD_COMPONENT__ = loadComponent;
  global.__VERYFRONT_PRELOAD_COMPONENT__ = preloadComponent;
  global.__VERYFRONT_GET_CACHED_COMPONENT__ = getCachedComponent;
}
