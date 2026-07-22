import type { ComponentType } from "react";
import { pathToModuleUrl } from "./path-utils.ts";

const componentCache = new Map<string, ComponentType<unknown>>();
interface PendingComponentLoad {
  promise: Promise<ComponentType<unknown> | null>;
  token: symbol;
}

const loadingPromises = new Map<string, PendingComponentLoad>();
// JavaScript runtimes retain failed module loads by URL. Keep a deterministic
// revision until the next success so retries can bypass that negative entry.
const failedImportAttempts = new Map<string, number>();
let cacheGeneration = 0;

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

function moduleUrlForAttempt(moduleUrl: string, attempt: number, generation: number): string {
  if (attempt === 0 && generation === 0) return moduleUrl;

  // A fragment changes module identity without changing the HTTP request, so
  // signed release-asset URLs and their query parameters remain intact.
  const separator = moduleUrl.includes("#") ? "&" : "#";
  return `${moduleUrl}${separator}__veryfront_generation=${generation}&__veryfront_retry=${attempt}`;
}

export function loadComponent(path: string): Promise<ComponentType<unknown> | null> {
  if (!path) return Promise.resolve(null);

  let moduleUrl: string;
  try {
    moduleUrl = cacheKeyForPath(path);
  } catch (error) {
    const errorName = error instanceof Error ? error.name : "UnknownError";
    console.error(`[Veryfront] Failed to load component: ${path} (${errorName})`);
    return Promise.resolve(null);
  }
  const cached = componentCache.get(moduleUrl);
  if (cached) return Promise.resolve(cached);

  const existingLoad = loadingPromises.get(moduleUrl);
  if (existingLoad) return existingLoad.promise;

  const generation = cacheGeneration;
  const importAttempt = failedImportAttempts.get(moduleUrl) ?? 0;
  const importUrl = moduleUrlForAttempt(moduleUrl, importAttempt, generation);
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

      failedImportAttempts.delete(moduleUrl);
      componentCache.set(moduleUrl, Component);
      return Component;
    } catch (error) {
      if (
        generation === cacheGeneration && loadingPromises.get(moduleUrl)?.token === loadToken
      ) {
        failedImportAttempts.set(
          moduleUrl,
          Math.max(failedImportAttempts.get(moduleUrl) ?? 0, importAttempt + 1),
        );
      }
      const errorName = error instanceof Error ? error.name : "UnknownError";
      console.error(`[Veryfront] Failed to load component: ${path} (${errorName})`);
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
    return componentCache.get(cacheKeyForPath(path)) ?? null;
  } catch {
    return null;
  }
}

export function clearComponentCache(): void {
  cacheGeneration++;
  componentCache.clear();
  loadingPromises.clear();
  failedImportAttempts.clear();
}

// Expose component loader globally for hydration scripts
if (typeof window !== "undefined") {
  const global = window as unknown as Record<string, unknown>;
  global.__VERYFRONT_LOAD_COMPONENT__ = loadComponent;
  global.__VERYFRONT_PRELOAD_COMPONENT__ = preloadComponent;
  global.__VERYFRONT_GET_CACHED_COMPONENT__ = getCachedComponent;
}
