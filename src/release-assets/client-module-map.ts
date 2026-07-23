import { releaseAssetUrl } from "./constants.ts";
import { parseReleaseAssetManifest, type ReleaseAssetManifest } from "./manifest-schema.ts";

export function buildReleaseAssetModules(
  manifest?: ReleaseAssetManifest | null,
): Record<string, string> | undefined {
  const parsed = parseReleaseAssetManifest(manifest);
  if (!parsed) return undefined;

  const modules = Object.create(null) as Record<string, string>;
  for (const [path, entry] of Object.entries(parsed.modules)) {
    Object.defineProperty(modules, path, {
      enumerable: true,
      value: releaseAssetUrl(entry.contentHash, "js"),
    });
  }

  return Object.keys(modules).length > 0 ? Object.freeze(modules) : undefined;
}
