/**
 * npm registry client for dependency version resolution.
 *
 * Fetches package metadata from the npm registry to resolve bare specifiers
 * to pinned versions. Results are cached in-process per project. All lookups
 * are non-blocking: callers receive a cached result or undefined while a
 * background fetch warms the cache for the next render.
 *
 * MUST NOT block or fail a render. All network errors fall back silently.
 *
 * @module transforms/esm/npm-registry-client
 */

import { rendererLogger } from "#veryfront/utils";
import { getHostEnv } from "#veryfront/platform/compat/process.ts";
import { HTTP_FETCH_TIMEOUT_MS } from "#veryfront/utils/constants/http.ts";
import { stripSemverRange } from "./package-registry.ts";
import { DEPENDENCY_PINNING_ENV_FLAG } from "../../release-assets/constants.ts";

const logger = rendererLogger.component("npm-registry-client");

/** Per-project cache: projectDir -> packageName -> resolved version string */
const versionCache = new Map<string, Map<string, string>>();

/** Deduplicates concurrent fetches for the same package+project pair */
const pendingFetches = new Set<string>();

function pendingKey(projectDir: string, packageName: string): string {
  return `${projectDir}\0${packageName}`;
}

/** True when the string is a bare three-part semver version (no range prefix). */
export function isExactSemver(s: string): boolean {
  return /^\d+\.\d+\.\d+(-[\w.]+)?(\+[\w.]+)?$/.test(s);
}

/**
 * True when the VERYFRONT_DEPENDENCY_PINNING env flag is set to "1".
 */
export function isDependencyPinningEnabled(): boolean {
  return getHostEnv(DEPENDENCY_PINNING_ENV_FLAG) === "1";
}

/**
 * Return a previously resolved version from the in-process cache, or undefined
 * when the cache is cold. Use scheduleNpmVersionResolution to warm it.
 */
export function getCachedNpmVersion(
  packageName: string,
  projectDir: string,
): string | undefined {
  return versionCache.get(projectDir)?.get(packageName);
}

function setCachedVersion(projectDir: string, packageName: string, version: string): void {
  let projectCache = versionCache.get(projectDir);
  if (!projectCache) {
    projectCache = new Map();
    versionCache.set(projectDir, projectCache);
  }
  projectCache.set(packageName, version);
}

/**
 * Schedule a non-blocking npm registry lookup for the package.
 *
 * - If rangeHint is an exact semver (after stripping range chars), it is stored
 *   directly without a network fetch and onResolved fires synchronously.
 * - Otherwise a background fetch is started. The result is stored in the cache
 *   and onResolved is called when it completes.
 * - Duplicate in-flight fetches for the same package+project are suppressed.
 * - Any failure is silently ignored; the cache stays cold for this call.
 *
 * @param packageName - npm package name
 * @param rangeHint   - raw semver string from package.json (may have ^ ~ >= etc.)
 * @param projectDir  - project root (used as cache scope)
 * @param onResolved  - optional callback with the resolved version string
 */
export function scheduleNpmVersionResolution(
  packageName: string,
  rangeHint: string | undefined,
  projectDir: string,
  onResolved?: (version: string, packageName: string, projectDir: string) => void,
): void {
  // Already cached: first writer wins, do not overwrite.
  if (versionCache.get(projectDir)?.has(packageName)) return;

  // Exact version from package.json: use it immediately without a network fetch.
  if (rangeHint) {
    const stripped = stripSemverRange(rangeHint);
    if (isExactSemver(stripped)) {
      setCachedVersion(projectDir, packageName, stripped);
      onResolved?.(stripped, packageName, projectDir);
      return;
    }
  }

  // In-flight deduplication.
  const key = pendingKey(projectDir, packageName);
  if (pendingFetches.has(key)) return;

  pendingFetches.add(key);

  fetchLatestNpmVersion(packageName)
    .then((version) => {
      if (version) {
        setCachedVersion(projectDir, packageName, version);
        onResolved?.(version, packageName, projectDir);
      }
    })
    .catch(() => {
      // Silently ignored — unversioned fallback remains in effect.
    })
    .finally(() => {
      pendingFetches.delete(key);
    });
}

/**
 * Fetch the latest published version of a package from the npm registry.
 * Uses the lighter install-metadata Accept header.
 * Returns null on any failure (network, timeout, unexpected response shape).
 */
async function fetchLatestNpmVersion(packageName: string): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HTTP_FETCH_TIMEOUT_MS);

  // Scoped package names like @tanstack/react-query need the / encoded in the
  // path segment but the @ left as-is so the registry recognizes the scope.
  const encodedName = packageName.startsWith("@")
    ? `${packageName.slice(0, packageName.indexOf("/"))}%2F${
      packageName.slice(packageName.indexOf("/") + 1)
    }`
    : packageName;

  try {
    const res = await fetch(`https://registry.npmjs.org/${encodedName}`, {
      headers: { Accept: "application/vnd.npm.install-v1+json" },
      signal: controller.signal,
    });

    if (!res.ok) {
      logger.debug("npm registry lookup returned non-OK status", {
        packageName,
        status: res.status,
      });
      return null;
    }

    const data = await res.json() as { "dist-tags"?: Record<string, string> };
    const latest = data["dist-tags"]?.latest ?? null;
    if (latest) logger.debug("npm registry resolved version", { packageName, version: latest });
    return latest;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      logger.debug("npm registry lookup timed out", { packageName });
    } else {
      logger.debug("npm registry lookup failed", { packageName, error: String(err) });
    }
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Fire-and-forget POST to the platform API to record a resolved dependency pin.
 *
 * Follows the same auth pattern as the Veryfront API transport: Bearer token
 * from the environment config. Silently ignores all failures including 404
 * (endpoint may not exist yet while the API track is built in parallel).
 *
 * @param projectId  - project identifier from the render context
 * @param specifiers - resolved specifiers in the form "pkg@version"
 */
export async function postDependencyResolution(
  projectId: string,
  specifiers: string[],
): Promise<void> {
  const { getEnvironmentConfig } = await import(
    "../../config/environment-config.ts"
  );
  const config = getEnvironmentConfig();
  const apiBaseUrl = config.apiBaseUrl;
  const apiToken = config.apiToken;

  if (!apiBaseUrl || !apiToken) {
    logger.debug("Skipping dependency resolution write-back: no API config", { projectId });
    return;
  }

  const url = `${apiBaseUrl}/projects/${encodeURIComponent(projectId)}/dependencies/resolve`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiToken}`,
      },
      body: JSON.stringify({ specifiers }),
      signal: controller.signal,
    });

    if (!res.ok && res.status !== 404) {
      logger.debug("Dependency resolution write-back returned non-OK status", {
        projectId,
        status: res.status,
      });
    }
  } catch (err) {
    logger.debug("Dependency resolution write-back failed", {
      projectId,
      error: String(err),
    });
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Clear the in-process caches. For use in tests only.
 */
export function _clearNpmVersionCache(): void {
  versionCache.clear();
  pendingFetches.clear();
}
