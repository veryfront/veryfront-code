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
import { RELEASE_ASSET_MANIFEST_KEY_MAX_BYTES, releaseAssetUrl } from "./constants.ts";
import { parseReleaseAssetManifest, type ReleaseAssetManifest } from "./manifest-schema.ts";

const logger = serverLogger.component("release-asset-consume");

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

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
  if (
    typeof path !== "string" || path.length > RELEASE_ASSET_MANIFEST_KEY_MAX_BYTES ||
    hasControlCharacter(path)
  ) {
    return "";
  }
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
  const parsed = parseReleaseAssetManifest(manifest);
  if (!parsed) {
    logger.debug("invalid release asset manifest during module resolution");
    return null;
  }
  const key = normalizeManifestModuleKey(logicalPath);
  if (!key) return null;
  const direct = parsed.modules[key];
  if (direct) return releaseAssetUrl(direct.contentHash, "js");

  // Tolerate keys that differ only by extension (e.g. ".js" vs source ext).
  const withoutExt = key.replace(/\.(tsx|ts|jsx|mdx|js)$/, "");
  for (const candidateExt of [".tsx", ".ts", ".jsx", ".mdx", ".js"]) {
    const candidate = parsed.modules[withoutExt + candidateExt];
    if (candidate) return releaseAssetUrl(candidate.contentHash, "js");
  }

  logger.debug("manifest module miss", { key });
  return null;
}

/** Resolve the route closure module URLs for preload hints from the manifest. */
export function resolveManifestRoutePreloadUrls(
  manifest: ReleaseAssetManifest,
  route: string,
): string[] {
  const parsed = parseReleaseAssetManifest(manifest);
  if (
    !parsed || typeof route !== "string" ||
    route.length > RELEASE_ASSET_MANIFEST_KEY_MAX_BYTES ||
    hasControlCharacter(route)
  ) {
    logger.debug("invalid release asset manifest or route during preload resolution");
    return [];
  }
  const entry = parsed.routes[route] ?? parsed.routes[`/${route}`] ??
    parsed.routes[route.replace(/^\//, "")];
  if (!entry) {
    logger.debug("manifest route miss", { route });
    return [];
  }

  const urls = new Set<string>();
  for (const modulePath of entry.modules) {
    const asset = parsed.modules[modulePath];
    if (asset) urls.add(releaseAssetUrl(asset.contentHash, "js"));
  }
  return [...urls];
}
