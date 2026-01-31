import type { ComponentType } from "react";
import { pathToModuleUrl } from "./path-utils.ts";

const componentCache = new Map<string, ComponentType<unknown>>();
const loadingPromises = new Map<string, Promise<ComponentType<unknown> | null>>();

export function loadComponent(path: string): Promise<ComponentType<unknown> | null> {
  if (!path) return Promise.resolve(null);

  const cached = componentCache.get(path);
  if (cached) return Promise.resolve(cached);

  const existingPromise = loadingPromises.get(path);
  if (existingPromise) return existingPromise;

  const loadPromise = (async (): Promise<ComponentType<unknown> | null> => {
    try {
      const moduleUrl = pathToModuleUrl(path);
      const module = await import(/* @vite-ignore */ moduleUrl);
      const Component = module.default ?? module;

      componentCache.set(path, Component);
      return Component;
    } catch (error) {
      console.error("[Veryfront] Failed to load component:", path, error);
      return null;
    } finally {
      loadingPromises.delete(path);
    }
  })();

  loadingPromises.set(path, loadPromise);
  return loadPromise;
}

export async function preloadComponent(path: string): Promise<void> {
  await loadComponent(path);
}

export function getCachedComponent(path: string): ComponentType<unknown> | null {
  return componentCache.get(path) ?? null;
}

export function clearComponentCache(): void {
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
