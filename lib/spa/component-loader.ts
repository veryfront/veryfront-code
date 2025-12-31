import type { ComponentType } from "react";
import { pathToModuleUrl } from "./path-utils.ts";

const componentCache = new Map<string, ComponentType<unknown>>();
const loadingPromises = new Map<string, Promise<ComponentType<unknown>>>();

export function loadComponent(path: string): Promise<ComponentType<unknown> | null> {
  if (!path) return Promise.resolve(null);

  // Check cache
  if (componentCache.has(path)) {
    return Promise.resolve(componentCache.get(path)!);
  }

  // Check if already loading
  if (loadingPromises.has(path)) {
    return loadingPromises.get(path)!;
  }

  // Start loading
  const loadPromise = (async () => {
    try {
      const moduleUrl = pathToModuleUrl(path);
      const module = await import(/* @vite-ignore */ moduleUrl);
      const Component = module.default || module;

      componentCache.set(path, Component);
      loadingPromises.delete(path);

      return Component;
    } catch (error) {
      console.error("[Veryfront] Failed to load component:", path, error);
      loadingPromises.delete(path);
      return null;
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
  (window as unknown as Record<string, unknown>).__VERYFRONT_LOAD_COMPONENT__ = loadComponent;
  (window as unknown as Record<string, unknown>).__VERYFRONT_PRELOAD_COMPONENT__ = preloadComponent;
  (window as unknown as Record<string, unknown>).__VERYFRONT_GET_CACHED_COMPONENT__ = getCachedComponent;
}
