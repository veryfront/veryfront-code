import { isValidContentHash, RELEASE_ASSET_CONTENT_TYPES, releaseAssetUrl } from "./constants.ts";
import type { ReleaseAssetManifest } from "./manifest-schema.ts";

export function buildReleaseAssetModules(
  manifest?: ReleaseAssetManifest | null,
  logicalPaths?: Iterable<string>,
): Record<string, string> | undefined {
  if (!manifest) return undefined;

  const modules: Record<string, string> = Object.create(null);
  const entries = logicalPaths
    ? Array.from(
      new Set(logicalPaths),
      (path) =>
        Object.hasOwn(manifest.modules, path) ? [path, manifest.modules[path]] as const : null,
    ).filter((entry): entry is readonly [string, ReleaseAssetManifest["modules"][string]] =>
      entry !== null
    )
    : Object.entries(manifest.modules);

  for (const [path, entry] of entries) {
    if (
      !entry ||
      entry.contentType !== RELEASE_ASSET_CONTENT_TYPES.js ||
      !isValidContentHash(entry.contentHash)
    ) {
      continue;
    }
    modules[path] = releaseAssetUrl(entry.contentHash, "js");
  }

  return Object.keys(modules).length > 0 ? modules : undefined;
}
