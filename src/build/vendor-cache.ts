/**************************************************
 * Vendor Bundle Cache
 *
 * Caches vendor bundles by dependency hash to avoid redundant builds.
 * Provides per-project vendor bundle management with automatic invalidation.
 **************************************************/

import { computeHash } from "#veryfront/utils";
import { createCacheNamespace } from "#veryfront/utils/cache-namespace.ts";

function buildVendorCacheConfig(
  reactVersion: string,
  dependencies: Record<string, string>,
): {
  react: string;
  deps: Array<[string, string]>;
} {
  return {
    react: reactVersion,
    deps: Object.entries(dependencies).sort(([left], [right]) => left.localeCompare(right)),
  };
}

export const VENDOR_CACHE_NAMESPACE = createCacheNamespace("vendor-build", {
  configSample: buildVendorCacheConfig("19.1.1", {
    "@radix-ui/react-slot": "1.2.3",
    react: "19.1.1",
  }),
  digest: "sha256-16hex",
});

export async function generateVendorCacheKey(
  projectId: string,
  reactVersion: string,
  dependencies: Record<string, string>,
): Promise<string> {
  const configStr = JSON.stringify({
    namespace: VENDOR_CACHE_NAMESPACE,
    ...buildVendorCacheConfig(reactVersion, dependencies),
  });

  const hash = (await computeHash(configStr)).slice(0, 16);

  return `vendor:${projectId}:${hash}`;
}
