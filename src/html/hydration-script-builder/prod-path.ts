export const PROD_HYDRATION_MODULE_PATH = "/_veryfront/hydration-runtime.js";
export const PROD_HYDRATION_MODULE_VERSIONED_PATH_PATTERN =
  /^\/_veryfront\/hydration-runtime\.[0-9a-f]{8}\.js$/;

export function isVersionedProdHydrationModulePath(pathname: string): boolean {
  return PROD_HYDRATION_MODULE_VERSIONED_PATH_PATTERN.test(pathname);
}

export function isProdHydrationModulePath(pathname: string): boolean {
  return pathname === PROD_HYDRATION_MODULE_PATH || isVersionedProdHydrationModulePath(pathname);
}
