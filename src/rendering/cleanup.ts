/**
 * Cleanup bundler and related caches
 *
 * Clears renderer caches and handlers for test and runtime cleanup.
 */
export async function cleanupBundler(): Promise<void> {
  const { clearMDXRendererCache } = await import("#veryfront/transforms/mdx/index.ts");
  clearMDXRendererCache();

  const { clearMDXModuleCache } = await import("./ssr/index.ts");
  clearMDXModuleCache();

  const { clearSSRModuleCache } = await import("#veryfront/modules");
  clearSSRModuleCache();

  const { destroyRendererAdapter } = await import("../server/shared/index.ts");
  await destroyRendererAdapter();

  try {
    const { __destroyRSCHandlerForTests } = await import(
      "../server/services/rsc/endpoints/handler-registry.ts"
    );
    __destroyRSCHandlerForTests();
  } catch (_) {
    /* expected: RSC handler registry might not be loaded */
  }
}
