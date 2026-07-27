import { isValidContentHash, RELEASE_ASSET_CONTENT_TYPES, releaseAssetUrl } from "./constants.ts";
import type { ReleaseAssetManifest } from "./manifest-schema.ts";

export function buildReleaseAssetModules(
  manifest?: ReleaseAssetManifest | null,
): Record<string, string> | undefined {
  if (!manifest) return undefined;

  const modules: Record<string, string> = Object.create(null);
  for (const [path, entry] of Object.entries(manifest.modules)) {
    if (
      entry.contentType !== RELEASE_ASSET_CONTENT_TYPES.js ||
      !isValidContentHash(entry.contentHash)
    ) {
      continue;
    }
    modules[path] = releaseAssetUrl(entry.contentHash, "js");
  }

  return Object.keys(modules).length > 0 ? modules : undefined;
}
