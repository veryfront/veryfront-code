import { isVersionedProdHydrationModulePath } from "#veryfront/html/hydration-script-builder/prod-scripts.ts";

/** Return whether an internal URL is a generated production asset. */
export function isProductionBuildAssetPath(pathname: string): boolean {
  return pathname === "/_veryfront/app.js" ||
    pathname === "/_veryfront/client.js" ||
    pathname === "/_veryfront/router.js" ||
    pathname === "/_veryfront/prefetch.js" ||
    pathname === "/_veryfront/hydration-runtime.js" ||
    isVersionedProdHydrationModulePath(pathname) ||
    pathname === "/_veryfront/manifest.json" ||
    pathname.startsWith("/_veryfront/chunks/") ||
    pathname.startsWith("/_veryfront/pages/") ||
    pathname.startsWith("/_veryfront/data/") ||
    pathname.startsWith("/_vf/assets/");
}

/** Return whether a missing generated asset can be resolved dynamically later. */
export function isDynamicBuildFallbackPath(pathname: string): boolean {
  return pathname.startsWith("/_veryfront/pages/") ||
    pathname.startsWith("/_veryfront/data/");
}
