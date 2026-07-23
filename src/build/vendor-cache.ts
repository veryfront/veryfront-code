/**************************************************
 * Vendor Bundle Cache
 *
 * Caches vendor bundles by dependency hash to avoid redundant builds.
 * Provides per-project vendor bundle management with automatic invalidation.
 **************************************************/

import { createCacheNamespace } from "#veryfront/utils/cache-namespace.ts";
import { hasUnsafeControlCharacters } from "#veryfront/errors/text-validation.ts";

const PROJECT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const DEPENDENCY_NAME_PATTERN = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i;
const MAX_PROJECT_ID_LENGTH = 128;
const MAX_DEPENDENCY_NAME_LENGTH = 214;
const MAX_DEPENDENCY_SPEC_LENGTH = 512;
const MAX_REACT_VERSION_LENGTH = 128;

function validateVendorCacheInputs(
  projectId: string,
  reactVersion: string,
  dependencies: Record<string, string>,
): void {
  if (
    typeof projectId !== "string" || projectId.length > MAX_PROJECT_ID_LENGTH ||
    !PROJECT_ID_PATTERN.test(projectId)
  ) {
    throw new TypeError("projectId must be a safe cache-key identifier");
  }
  if (
    typeof reactVersion !== "string" || !reactVersion || reactVersion.trim() !== reactVersion ||
    reactVersion.length > MAX_REACT_VERSION_LENGTH || hasUnsafeControlCharacters(reactVersion)
  ) {
    throw new TypeError("reactVersion must be a non-empty dependency version");
  }
  if (
    !dependencies || typeof dependencies !== "object" || Array.isArray(dependencies) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(dependencies))
  ) {
    throw new TypeError("dependencies must be a plain object");
  }

  for (const [name, version] of Object.entries(dependencies)) {
    if (
      name.length > MAX_DEPENDENCY_NAME_LENGTH || !DEPENDENCY_NAME_PATTERN.test(name)
    ) {
      throw new TypeError("dependencies must use valid npm package names");
    }
    if (
      typeof version !== "string" || !version || version.trim() !== version ||
      version.length > MAX_DEPENDENCY_SPEC_LENGTH || hasUnsafeControlCharacters(version)
    ) {
      throw new TypeError("dependency versions must be non-empty strings");
    }
  }
}

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
  validateVendorCacheInputs(projectId, reactVersion, dependencies);
  const configStr = JSON.stringify({
    namespace: VENDOR_CACHE_NAMESPACE,
    ...buildVendorCacheConfig(reactVersion, dependencies),
  });

  const data = new TextEncoder().encode(configStr);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hash = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);

  return `vendor:${projectId}:${hash}`;
}
