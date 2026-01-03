/**
 * Cleanup bundler and related caches
 *
 * When running in test mode with globally initialized esbuild,
 * the __vfTestPreserveEsbuild flag prevents stopping esbuild
 * to avoid triggering Deno's resource leak detection.
 */
export async function cleanupBundler() {
  const { clearMDXRendererCache } = await import("@veryfront/transforms/mdx/index.ts");
  await clearMDXRendererCache();

  const { clearMDXModuleCache } = await import("./ssr/index.ts");
  clearMDXModuleCache();

  // Skip renderer cleanup if esbuild was initialized globally for tests
  // This prevents "child process started before test but closed during test" errors
  if ((globalThis as Record<string, unknown>).__vfTestPreserveEsbuild) {
    return;
  }

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
