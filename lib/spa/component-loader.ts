import type { ComponentType } from "react";

const componentCache = new Map<string, ComponentType<unknown>>();
const loadingPromises = new Map<string, Promise<ComponentType<unknown>>>();

function getModuleServerUrl(): string {
  if (typeof window !== "undefined" && (window as { MODULE_SERVER_URL?: string }).MODULE_SERVER_URL) {
    return (window as { MODULE_SERVER_URL?: string }).MODULE_SERVER_URL!;
  }
  return "/_vf_modules";
}

function pathToModuleUrl(path: string): string {
  const baseUrl = getModuleServerUrl();

  // Try absolute path format (legacy): /project/dir/pages/foo.tsx
  let match = path.match(/\/(pages|components|app|lib|layouts|shared|features)\/(.+)\.(tsx|ts|jsx|mdx)$/);

  // Try project-relative path format: pages/foo.mdx or layouts/DefaultLayout.mdx
  if (!match) {
    match = path.match(/^(pages|components|app|lib|layouts|shared|features)\/(.+)\.(tsx|ts|jsx|mdx)$/);
  }

  if (!match) {
    // Direct path fallback
    return `${baseUrl}/${path.replace(/\.(tsx|ts|jsx|mdx)$/, ".js")}`;
  }

  return `${baseUrl}/${match[1]}/${match[2]}.js`;
}

export async function loadComponent(path: string): Promise<ComponentType<unknown> | null> {
  if (!path) return null;

  // Check cache
  if (componentCache.has(path)) {
    return componentCache.get(path)!;
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
      console.error("[Veryfront SPA] Failed to load component:", path, error);
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
