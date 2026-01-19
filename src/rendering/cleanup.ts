/**
 * Cleanup bundler and related caches
 *
 * Clears renderer caches and handlers for test and runtime cleanup.
 */
export async function cleanupBundler() {
  const { clearMDXRendererCache } = await import("@veryfront/transforms/mdx/index.ts");
  clearMDXRendererCache();

  const { clearMDXModuleCache } = await import("./ssr/index.ts");
  clearMDXModuleCache();

  // Clean up the shared renderer (for testing)
  const { destroyRendererAdapter } = await import("../server/shared/index.ts");
  await destroyRendererAdapter();

  // Clean up RSC handler cache and stop interval to prevent resource leaks
  try {
    const { __destroyRSCHandlerForTests } = await import(
      "../server/handlers/request/rsc/endpoints/handler-registry.ts"
    );
    __destroyRSCHandlerForTests();
  } catch {
    // RSC handler registry might not be loaded
  }
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
