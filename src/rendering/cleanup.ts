/**
 * Cleanup bundler and related caches
 *
 * When running in test mode with globally initialized esbuild,
 * the __vfTestPreserveEsbuild flag prevents stopping esbuild
 * to avoid triggering Deno's resource leak detection.
 */
export async function cleanupBundler() {
  const { clearMDXRendererCache } = await import("@veryfront/transforms/mdx/index.ts");
  clearMDXRendererCache();

  const { clearMDXModuleCache } = await import("./ssr/index.ts");
  clearMDXModuleCache();

  // Always clean up renderers to prevent test isolation issues
  // (each test needs a fresh renderer with its own projectDir)
  const { cleanupRenderers } = await import("../server/shared/index.ts");
  await cleanupRenderers();
}

export async function configureRendererNamespace(namespace: string) {
  try {
    const { setCacheNamespace } = await import(
      "@veryfront/utils/cache/keys/namespace.ts"
    );
    setCacheNamespace(namespace);
  } catch {
    // Cache namespace configuration is optional
  }
}
