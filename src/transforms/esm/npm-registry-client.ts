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
import { DEPENDENCY_PINNING_ENV_FLAG } from "../../release-assets/constants.ts";

const logger = rendererLogger.component("npm-registry-client");
const SEMVER_IDENTIFIER = "[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*";
const EXACT_SEMVER_RE = new RegExp(
  `^\\d+\\.\\d+\\.\\d+(?:-${SEMVER_IDENTIFIER})?(?:\\+${SEMVER_IDENTIFIER})?$`,
);

/**
 * Maximum number of distinct project directories held in the version cache.
 * When exceeded, the oldest entry is evicted (Maps preserve insertion order).
 * Bounds memory in long-running server processes that serve many projects.
 */
const VERSION_CACHE_MAX_PROJECTS = 256;

/** Resolved version paired with the range hint that produced it.
 * Storing the hint lets scheduleNpmVersionResolution detect when
 * package.json changes (e.g. "^1" → "^2") and re-resolve accordingly. */
interface CachedEntry {
  version: string | undefined;
  hint: string | undefined;
}

/** Per-project cache: projectDir -> packageName -> CachedEntry */
const versionCache = new Map<string, Map<string, CachedEntry>>();

/** Deduplicates concurrent fetches for the same package, project, and declaration. */
const pendingFetches = new Set<string>();

/**
 * Tracks in-flight background resolution promises so tests can await
 * _pendingResolutions() to drain all open fetch handles and timers before
 * the Deno leak sanitizer runs.
 */
const pendingResolutionPromises = new Set<Promise<void>>();

function pendingKey(projectDir: string, packageName: string, hint: string | undefined): string {
  return `${projectDir}\0${packageName}\0${hint ?? ""}`;
}

/** True when the string is a bare three-part semver version (no range prefix). */
export function isExactSemver(s: string): boolean {
  return EXACT_SEMVER_RE.test(s);
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
  rangeHint: string | undefined,
): string | undefined {
  const entry = versionCache.get(projectDir)?.get(packageName);
  return entry !== undefined && entry.hint === rangeHint ? entry.version : undefined;
}

function setCurrentResolution(
  projectDir: string,
  packageName: string,
  hint: string | undefined,
  version?: string,
): void {
  let projectCache = versionCache.get(projectDir);
  if (!projectCache) {
    // Evict the oldest project entry when the cap is reached. JavaScript Maps
    // preserve insertion order, so keys().next().value is the oldest key.
    if (versionCache.size >= VERSION_CACHE_MAX_PROJECTS) {
      const oldest = versionCache.keys().next().value;
      if (oldest !== undefined) versionCache.delete(oldest);
    }
    projectCache = new Map();
    versionCache.set(projectDir, projectCache);
  }
  projectCache.set(packageName, { version, hint });
}

/**
 * Schedule a non-blocking npm registry lookup for the package.
 *
 * - If rangeHint is already an exact semver literal (no range prefix stripped),
 *   it is stored directly without a network fetch and onResolved fires synchronously.
 * - A non-exact package declaration is left unresolved. Resolving it to the
 *   registry's global latest could violate the project's declared constraint.
 * - When no declaration exists, a background latest-version fetch is started.
 *   The result is stored in the cache and onResolved is called when it completes.
 * - Duplicate in-flight fetches for the same package, project, and declaration
 *   are suppressed.
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
  const cached = versionCache.get(projectDir)?.get(packageName);
  if (
    cached !== undefined &&
    cached.hint === rangeHint &&
    cached.version !== undefined
  ) return;

  // Exact version from package.json: use it immediately without a network fetch.
  // Only short-circuit when the raw hint is already an exact semver — never strip
  // range prefixes (^, ~, >=) to manufacture a pin that package.json didn't contain.
  if (rangeHint && isExactSemver(rangeHint)) {
    setCurrentResolution(projectDir, packageName, rangeHint, rangeHint);
    onResolved?.(rangeHint, packageName, projectDir);
    return;
  }

  // Do not coerce a declared range, dist-tag, alias, workspace reference, or
  // other non-exact package specifier to dist-tags.latest. Until the platform
  // resolver normalizes that declaration to an exact version, callers retain
  // the existing unversioned fallback rather than silently crossing its bounds.
  if (rangeHint !== undefined) {
    // Record the declaration even without a resolved version. This invalidates
    // both an older cached latest and any unversioned fetch that is still in
    // flight, preventing its late result from crossing the new constraint.
    if (cached === undefined || cached.hint !== rangeHint) {
      setCurrentResolution(projectDir, packageName, rangeHint);
    }
    return;
  }

  // Mark the absence of a declaration as current before consulting the
  // in-flight registry. A late fetch from an older state will then be ignored.
  if (cached === undefined || cached.hint !== rangeHint) {
    setCurrentResolution(projectDir, packageName, rangeHint);
  }

  // In-flight deduplication.
  const key = pendingKey(projectDir, packageName, rangeHint);
  if (pendingFetches.has(key)) return;

  pendingFetches.add(key);

  // The finally closure captures `resolution` by reference. By the time it
  // executes (asynchronously after the promise settles), the const is
  // fully initialized — no temporal dead zone issue.
  const resolution: Promise<void> = fetchLatestNpmVersion(packageName)
    .then((version) => {
      if (!version) return;
      const current = versionCache.get(projectDir)?.get(packageName);
      if (current === undefined || current.hint !== rangeHint) return;
      current.version = version;
      onResolved?.(version, packageName, projectDir);
    })
    .catch(() => {
      // Silently ignored — unversioned fallback remains in effect.
    })
    .finally(() => {
      pendingFetches.delete(key);
      pendingResolutionPromises.delete(resolution);
    });
  pendingResolutionPromises.add(resolution);
}

/**
 * Fetch the latest published version of a package with no project declaration
 * from the npm registry.
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
 * Clear resolved versions. For use in tests only.
 *
 * This intentionally retains in-flight tracking: callers must still be able
 * to await already-started fetches via _pendingResolutions() so their handles
 * and timers do not escape test teardown. Tests that schedule work should
 * await _pendingResolutions() before calling this helper.
 */
export function _clearNpmVersionCache(): void {
  versionCache.clear();
}

/**
 * Resolves when all in-flight background npm version resolutions have settled.
 *
 * For use in tests only. Call this in afterEach after any test that schedules
 * resolution for a package without a project declaration. Awaiting it ensures
 * no open fetch handles or AbortController timers remain when the Deno leak
 * sanitizer inspects test teardown.
 */
export function _pendingResolutions(): Promise<void> {
  if (pendingResolutionPromises.size === 0) return Promise.resolve();
  return Promise.allSettled([...pendingResolutionPromises]).then(() => {});
}
