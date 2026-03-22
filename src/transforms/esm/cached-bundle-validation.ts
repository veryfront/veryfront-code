import { extractHttpBundlePaths } from "#veryfront/modules/react-loader/ssr-module-loader/http-bundle-helpers.ts";
import { ensureHttpBundlesExist } from "./http-cache.ts";
import { type ManifestValidationReason, validateBundleGroup } from "./bundle-manifest.ts";

export interface CachedBundleValidationResult {
  valid: boolean;
  failedHashes: string[];
  reason?: ManifestValidationReason;
  source: "manifest" | "code";
}

export async function validateCachedBundlesByManifestOrCode(
  code: string,
  bundleManifestId: string | undefined,
  cacheDir: string,
): Promise<CachedBundleValidationResult> {
  if (bundleManifestId) {
    const validation = await validateBundleGroup(bundleManifestId, cacheDir);
    if (validation.valid || validation.reason === "bundle_missing") {
      return { ...validation, source: "manifest" };
    }
  }

  const bundlePaths = extractHttpBundlePaths(code);
  if (bundlePaths.length === 0) {
    return { valid: true, failedHashes: [], source: "code" };
  }

  const failedHashes = await ensureHttpBundlesExist(bundlePaths, cacheDir);
  if (failedHashes.length === 0) {
    return { valid: true, failedHashes: [], source: "code" };
  }

  return {
    valid: false,
    failedHashes,
    reason: "bundle_missing",
    source: "code",
  };
}
