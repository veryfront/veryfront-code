import {
  clearSSRModuleCache,
  clearSSRModuleCacheForProject,
} from "#veryfront/modules/react-loader/ssr-module-loader/cache/index.ts";
import { clearRouterDetectionCacheForProject } from "#veryfront/rendering/router-detection.ts";
import {
  clearModulePathCache,
  invalidateModulePaths,
} from "#veryfront/transforms/mdx/esm-module-loader/cache/index.ts";
import { clearSnippetCacheForProject } from "#veryfront/rendering/snippet-renderer.ts";
import { clearRendererCacheForProject } from "#veryfront/rendering/renderer.ts";
import { invalidateProjectCSS } from "#veryfront/html/styles-builder/tailwind-compiler.ts";
import { invalidatePreparedProjectCSS } from "#veryfront/html/styles-builder/prepared-project-css-cache.ts";
import { invalidateProjectCandidateManifests } from "#veryfront/rendering/orchestrator/css-candidate-manifest.ts";
import type { InvalidationCallbacks } from "./types.ts";

export function createDefaultInvalidationCallbacks(
  callbacks?: InvalidationCallbacks,
): InvalidationCallbacks {
  return {
    clearSSRModuleCache,
    clearModulePathCache,
    invalidateModulePaths,
    clearSSRModuleCacheForProject,
    clearRouterDetectionCacheForProject,
    clearSnippetCacheForProject,
    clearRendererCacheForProject,
    clearProjectCSSCache: (projectSlug: string) => {
      invalidateProjectCSS(projectSlug);
      invalidatePreparedProjectCSS(projectSlug);
      invalidateProjectCandidateManifests(projectSlug);
    },
    ...callbacks,
  };
}
