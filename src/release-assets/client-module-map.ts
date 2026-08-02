import { isValidContentHash, RELEASE_ASSET_CONTENT_TYPES, releaseAssetUrl } from "./constants.ts";
import type { ReleaseAssetManifest } from "./manifest-schema.ts";

export interface BuildReleaseAssetModulesOptions {
  /** Prefer the manifest closure for this route, falling back to the full map when stale. */
  route?: string | null;
  /** Restrict non-route callers to an explicit set of logical module paths. */
  logicalPaths?: Iterable<string>;
}

function buildModuleMap(
  manifest: ReleaseAssetManifest,
  logicalPaths: Iterable<string>,
  requireComplete: boolean,
): Record<string, string> | undefined {
  const modules: Record<string, string> = Object.create(null);

  for (const path of new Set(logicalPaths)) {
    if (!Object.hasOwn(manifest.modules, path)) {
      if (requireComplete) return undefined;
      continue;
    }

    const entry = manifest.modules[path];
    if (
      !entry ||
      entry.contentType !== RELEASE_ASSET_CONTENT_TYPES.js ||
      typeof entry.contentHash !== "string" ||
      !isValidContentHash(entry.contentHash)
    ) {
      if (requireComplete) return undefined;
      continue;
    }

    modules[path] = releaseAssetUrl(entry.contentHash, "js");
  }

  return Object.keys(modules).length > 0 ? modules : undefined;
}

export function buildReleaseAssetModules(
  manifest?: ReleaseAssetManifest | null,
  options: BuildReleaseAssetModulesOptions = {},
): Record<string, string> | undefined {
  if (!manifest) return undefined;

  if (options.route) {
    const routeEntry = Object.hasOwn(manifest.routes, options.route)
      ? manifest.routes[options.route]
      : undefined;
    if (routeEntry?.modules.length) {
      const routeModules = buildModuleMap(manifest, routeEntry.modules, true);
      if (routeModules) return routeModules;
    }

    // Missing, empty, or stale route metadata must not produce an incomplete
    // hydration map. Rebuild from the validated full manifest instead.
    return buildModuleMap(manifest, Object.keys(manifest.modules), false);
  }

  return buildModuleMap(
    manifest,
    options.logicalPaths ?? Object.keys(manifest.modules),
    false,
  );
}
