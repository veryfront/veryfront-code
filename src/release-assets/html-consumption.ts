/**
 * Release Asset Manifest — HTML consumption helpers.
 *
 * Pure helpers used by the HTML shell generator to rewrite module URLs and
 * preload hints to content-addressed `/_vf/assets/{hash}.js` URLs when a ready
 * manifest covers the entry. Misses fall back to the existing URL (per-entry)
 * and are counted via structured debug logs.
 *
 * @module release-assets/html-consumption
 */

import { serverLogger } from "#veryfront/utils";
import { isValidContentHash, RELEASE_ASSET_CONTENT_TYPES, releaseAssetUrl } from "./constants.ts";
import type { ReleaseAssetManifest } from "./manifest-schema.ts";

const logger = serverLogger.component("release-asset-consume");

/**
 * Normalize a logical module path to the manifest's key convention.
 *
 * The HTML shell works with relative source paths like `pages/index.tsx` and
 * `/_vf_modules/pages/index.js` URLs. Manifest module keys use the logical
 * source path (e.g. `pages/index.tsx`). This strips a leading `/_vf_modules/`
 * prefix and URL query/hash data before the resolver compares source
 * extensions.
 */
export function normalizeManifestModuleKey(path: string): string {
  if (typeof path !== "string") return "";
  let key = path.replace(/^\/?_vf_modules\//, "");
  key = key.replace(/^\/+/, "");
  key = key.replace(/[?#].*$/, "");
  return key;
}

/**
 * Resolve a module URL through the manifest.
 *
 * Returns the content-addressed asset URL on a hit, or null on a miss (caller
 * keeps the existing URL). The manifest is consulted by both the logical key
 * and its `.js`-stripped form to tolerate either input shape.
 */
export function resolveManifestModuleUrl(
  manifest: ReleaseAssetManifest,
  logicalPath: string,
): string | null {
  const key = normalizeManifestModuleKey(logicalPath);
  const direct = ownEntry(manifest.modules, key);
  if (isUsableJavaScriptAsset(direct)) return releaseAssetUrl(direct.contentHash, "js");

  // Tolerate keys that differ only by extension (e.g. ".js" vs source ext).
  const withoutExt = key.replace(/\.(tsx|ts|jsx|mdx|js)$/, "");
  for (const candidateExt of [".tsx", ".ts", ".jsx", ".mdx", ".js"]) {
    const candidate = ownEntry(manifest.modules, withoutExt + candidateExt);
    if (isUsableJavaScriptAsset(candidate)) {
      return releaseAssetUrl(candidate.contentHash, "js");
    }
  }

  logger.debug("manifest module miss", { key });
  return null;
}

/** Resolve the route closure module URLs for preload hints from the manifest. */
export function resolveManifestRoutePreloadUrls(
  manifest: ReleaseAssetManifest,
  route: string,
): string[] {
  const entry = ownEntry(manifest.routes, route) ??
    ownEntry(manifest.routes, `/${route}`) ??
    ownEntry(manifest.routes, route.replace(/^\//, ""));
  if (!entry) {
    logger.debug("manifest route miss", { route });
    return [];
  }

  const urls = new Set<string>();
  for (const modulePath of entry.modules) {
    const asset = ownEntry(manifest.modules, modulePath);
    if (isUsableJavaScriptAsset(asset)) {
      urls.add(releaseAssetUrl(asset.contentHash, "js"));
    }
  }
  return [...urls];
}

function ownEntry<T>(record: Record<string, T>, key: string): T | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

function isUsableJavaScriptAsset(
  value: ReleaseAssetManifest["modules"][string] | undefined,
): value is ReleaseAssetManifest["modules"][string] {
  return value !== undefined &&
    value.contentType === RELEASE_ASSET_CONTENT_TYPES.js &&
    isValidContentHash(value.contentHash);
}
