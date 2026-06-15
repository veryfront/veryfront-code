import { releaseAssetUrl } from "./constants.ts";
import type { ReleaseAssetManifest } from "./manifest-schema.ts";

export function buildReleaseAssetModules(
  manifest?: ReleaseAssetManifest | null,
): Record<string, string> | undefined {
  if (!manifest) return undefined;

  const modules: Record<string, string> = {};
  for (const [path, entry] of Object.entries(manifest.modules)) {
    modules[path] = releaseAssetUrl(entry.contentHash, "js");
  }

  return Object.keys(modules).length > 0 ? modules : undefined;
}
