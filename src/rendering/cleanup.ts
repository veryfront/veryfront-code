export async function cleanupBundler() {
  const { clearMDXRendererCache } = await import("@veryfront/transforms/mdx/index.ts");
  await clearMDXRendererCache();

  const { clearMDXModuleCache } = await import("./ssr/index.ts");
  clearMDXModuleCache();

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
