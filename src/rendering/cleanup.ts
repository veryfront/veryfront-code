/**
 * Rendering Cleanup Utilities
 *
 * Separated from bundler.ts to avoid circular dependency with renderer-manager.ts
 */

import { rendererLogger as logger } from "@veryfront/utils";

export async function cleanupBundler() {
  // Clear MDX renderer cache
  const { clearMDXRendererCache } = await import("@veryfront/transforms/mdx/index.ts");
  await clearMDXRendererCache();

  // Clear SSR module cache
  const { clearMDXModuleCache } = await import("./ssr/index.ts");
  clearMDXModuleCache();

  // Clean up all renderer instances (destroys cache stores and intervals)
  const { cleanupRenderers } = await import("../server/handlers/request/ssr/renderer-manager.ts");
  await cleanupRenderers();
}

/**
 * Configure isolation namespace for caches used during rendering.
 * Call this in test setup to avoid cross-test interference.
 */
export async function configureRendererNamespace(namespace: string) {
  try {
    const { setCacheNamespace } = await import(
      "@veryfront/utils/cache/keys/namespace.ts"
    );
    setCacheNamespace(namespace);
  } catch (error) {
    // Cache namespace configuration is optional - continue without it
    logger.debug(`Could not configure cache namespace: ${error}`);
  }
}
