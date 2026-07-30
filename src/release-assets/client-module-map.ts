import { releaseAssetUrl } from "./constants.ts";
import type { ReleaseAssetManifest } from "./manifest-schema.ts";

export function buildReleaseAssetModules(
  manifest?: ReleaseAssetManifest | null,
  options: { route?: string | null } = {},
): Record<string, string> | undefined {
  if (!manifest) return undefined;

  const routeModules = options.route ? manifest.routes[options.route]?.modules : undefined;
  const buildFallback = (): Record<string, string> | undefined => {
    const fallbackModules: Record<string, string> = {};
    for (const [path, entry] of Object.entries(manifest.modules)) {
      fallbackModules[path] = releaseAssetUrl(entry.contentHash, "js");
    }
    return Object.keys(fallbackModules).length > 0 ? fallbackModules : undefined;
  };

  if (!routeModules) return buildFallback();
  if (routeModules.length === 0) return buildFallback();

  const modules: Record<string, string> = {};
  for (const path of routeModules) {
    const entry = manifest.modules[path];
    if (!entry) return buildFallback();
    modules[path] = releaseAssetUrl(entry.contentHash, "js");
  }

  return modules;
}
