import type { InvalidationCallbacks } from "./types.ts";

function loadModule<T>(specifier: string): Promise<T> {
  return import(specifier) as Promise<T>;
}

export function createDefaultInvalidationCallbacks(
  callbacks?: InvalidationCallbacks,
): InvalidationCallbacks {
  return {
    clearSSRModuleCache: () => {
      void loadModule<{ clearSSRModuleCache: () => void }>(
        "#veryfront/modules/react-loader/ssr-module-loader/cache/index.ts",
      ).then((m) => m.clearSSRModuleCache());
    },
    clearModulePathCache: () => {
      void loadModule<{ clearModulePathCache: () => void }>(
        "#veryfront/transforms/mdx/esm-module-loader/cache/index.ts",
      ).then((m) => m.clearModulePathCache());
    },
    invalidateModulePaths: (changedPaths: string[]) => {
      void loadModule<{ invalidateModulePaths: (changedPaths: string[]) => void }>(
        "#veryfront/transforms/mdx/esm-module-loader/cache/index.ts",
      ).then((m) => m.invalidateModulePaths(changedPaths));
    },
    clearSSRModuleCacheForProject: (projectId: string) => {
      void loadModule<{ clearSSRModuleCacheForProject: (projectId: string) => void }>(
        "#veryfront/modules/react-loader/ssr-module-loader/cache/index.ts",
      ).then((m) => m.clearSSRModuleCacheForProject(projectId));
    },
    clearRouterDetectionCacheForProject: (projectId: string) => {
      void loadModule<{ clearRouterDetectionCacheForProject: (projectId: string) => void }>(
        "#veryfront/rendering/router-detection.ts",
      ).then((m) => m.clearRouterDetectionCacheForProject(projectId));
    },
    clearSnippetCacheForProject: (projectSlug: string) => {
      void loadModule<{ clearSnippetCacheForProject: (projectSlug: string) => void }>(
        "#veryfront/rendering/snippet-renderer.ts",
      ).then((m) => m.clearSnippetCacheForProject(projectSlug));
    },
    clearRendererCacheForProject: async (projectId: string) => {
      const { clearRendererCacheForProject } = await loadModule<{
        clearRendererCacheForProject: (projectId: string) => void | Promise<void>;
      }>("#veryfront/rendering/renderer.ts");
      return clearRendererCacheForProject(projectId);
    },
    ...callbacks,
  };
}
