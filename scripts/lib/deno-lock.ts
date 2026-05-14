/**
 * Shared helpers for parsing deno.lock v5 npm entries.
 *
 * Used by `scripts/build/generate-sbom.ts` (CycloneDX export) and
 * `scripts/security/submit-dependency-snapshot.ts` (GitHub Dependency
 * Submission). Keep this module dependency-free so it can be imported by
 * any script without pulling in network or fs permissions.
 */

/**
 * Lockfile versions whose schema these helpers have been validated against.
 * Bump (and re-test) when Deno introduces a new lock format.
 */
export const SUPPORTED_LOCK_VERSIONS = ["5"] as const;

export interface DenoLockV5 {
  version: string;
  specifiers?: Record<string, string>;
  npm?: Record<string, { integrity?: string; dependencies?: string[] }>;
  jsr?: Record<string, unknown>;
  workspace?: {
    dependencies?: string[];
    members?: Record<string, { dependencies?: string[] }>;
  };
}

/**
 * Split a deno.lock npm key (`name@version` or `name@version_peer@x`) into
 * its name and base version, discarding any peer-dep suffix. Returns null
 * for keys that can't be parsed (e.g. bare names with no `@`).
 */
export function parseNameVersion(
  key: string,
): { name: string; version: string } | null {
  let scope = "";
  let rest = key;
  if (key.startsWith("@")) {
    const slash = key.indexOf("/");
    if (slash < 0) return null;
    scope = key.slice(0, slash + 1);
    rest = key.slice(slash + 1);
  }
  const at = rest.indexOf("@");
  if (at <= 0) return null;
  const name = scope + rest.slice(0, at);
  let version = rest.slice(at + 1);
  const underscore = version.indexOf("_");
  if (underscore >= 0) version = version.slice(0, underscore);
  return { name, version };
}

export function canonicalNpmKey(key: string): string | null {
  const nv = parseNameVersion(key);
  return nv ? `${nv.name}@${nv.version}` : null;
}

export function npmNameFromSpecifier(specifier: string): string | null {
  if (!specifier.startsWith("npm:")) return null;
  const bare = specifier.slice("npm:".length);
  const lastAt = bare.lastIndexOf("@");
  if (lastAt <= 0) return null;
  return bare.slice(0, lastAt);
}

/** Build a `pkg:npm/...` Package URL for a name+version pair. */
export function purl(name: string, version: string): string {
  const encoded = name.split("/").map(encodeURIComponent).join("/");
  return `pkg:npm/${encoded}@${version}`;
}

/**
 * Parse and validate a deno.lock JSON blob. Throws if the lock version is
 * not in {@link SUPPORTED_LOCK_VERSIONS}.
 */
export function parseLock(lockText: string): DenoLockV5 {
  const lock = JSON.parse(lockText) as DenoLockV5;
  if (
    !SUPPORTED_LOCK_VERSIONS.includes(
      lock.version as typeof SUPPORTED_LOCK_VERSIONS[number],
    )
  ) {
    throw new Error(
      `Unsupported deno.lock version: "${lock.version}" (supported: ${
        SUPPORTED_LOCK_VERSIONS.join(", ")
      })`,
    );
  }
  return lock;
}
