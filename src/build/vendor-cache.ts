/**************************************************
 * Vendor Bundle Cache
 *
 * Caches vendor bundles by dependency hash to avoid redundant builds.
 * Provides per-project vendor bundle management with automatic invalidation.
 **************************************************/

const TRANSFORM_VERSION = "3";

export async function generateVendorCacheKey(
  projectId: string,
  reactVersion: string,
  dependencies: Record<string, string>,
): Promise<string> {
  const configStr = JSON.stringify({
    transformVersion: TRANSFORM_VERSION,
    react: reactVersion,
    deps: Object.entries(dependencies).sort(([a], [b]) => a.localeCompare(b)),
  });

  const data = new TextEncoder().encode(configStr);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hash = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);

  return `vendor:${projectId}:${hash}`;
}

