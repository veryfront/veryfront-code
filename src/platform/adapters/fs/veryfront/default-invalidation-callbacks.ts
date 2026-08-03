import type { InvalidationCallbacks } from "./types.ts";

function loadModule<T>(specifier: string): Promise<T> {
  return import(specifier) as Promise<T>;
}

export function createDefaultInvalidationCallbacks(
  callbacks?: InvalidationCallbacks,
): InvalidationCallbacks {
  return {
    clearSSRModuleCache: () => {
      return loadModule<{ clearSSRModuleCache: () => void }>(
        "#veryfront/modules/react-loader/ssr-module-loader/cache/index.ts",
      ).then((m) => m.clearSSRModuleCache());
    },
    clearModulePathCache: () => {
      return loadModule<{ clearModulePathCache: () => void }>(
        "#veryfront/transforms/mdx/esm-module-loader/cache/index.ts",
      ).then((m) => m.clearModulePathCache());
    },
    invalidateModulePaths: (changedPaths: string[]) => {
      return loadModule<{ invalidateModulePaths: (changedPaths: string[]) => void }>(
        "#veryfront/transforms/mdx/esm-module-loader/cache/index.ts",
      ).then((m) => m.invalidateModulePaths(changedPaths));
    },
    clearSSRModuleCacheForProject: (projectId: string) => {
      return loadModule<{ clearSSRModuleCacheForProject: (projectId: string) => void }>(
        "#veryfront/modules/react-loader/ssr-module-loader/cache/index.ts",
      ).then((m) => m.clearSSRModuleCacheForProject(projectId));
    },
    clearRouterDetectionCacheForProject: async (projectId: string) => {
      const module = await loadModule<{
        clearRouterDetectionCacheForProject: (projectId: string) => void;
      }>(
        "#veryfront/rendering/router-detection.ts",
      );
      module.clearRouterDetectionCacheForProject(projectId);
    },
    clearProjectDiscoveryCacheForProject: async (projectId: string) => {
      const module = await loadModule<{
        clearProjectDiscoveryCacheForProject: (projectId: string) => void;
      }>(
        "#veryfront/server/handlers/request/api/project-discovery.ts",
      );
      module.clearProjectDiscoveryCacheForProject(projectId);
    },
    clearSnippetCacheForProject: (projectSlug: string) => {
      return loadModule<{ clearSnippetCacheForProject: (projectSlug: string) => void }>(
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
