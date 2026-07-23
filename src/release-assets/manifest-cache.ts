/**
 * Release Asset Manifest — in-process consumption cache (production HTML).
 *
 * Fetches manifests from the project-scoped GET endpoint once per release and
 * caches them keyed by `${releaseId}:${manifestVersion}`. Ready manifests are
 * cached for a bounded TTL (15 min) so superseded manifests are eventually
 * replaced; non-ready / missing results are cached for a short TTL so the
 * common "no manifest" case stays cheap.
 *
 * Consumption is gated by `VERYFRONT_RELEASE_ASSET_MANIFEST=1` (default OFF).
 * When the flag is off, `getReadyManifestForRender` always returns null so the
 * HTML output is byte-identical to today.
 *
 * Most callers use the non-blocking read so fallback stays cheap. HTML shell
 * generation uses the awaited read so import maps, preload hints, CSS, and
 * hydration data are generated from one manifest snapshot.
 *
 * Multi-tenancy: each releaseId is served by the fetcher registered for that
 * specific releaseId (the adapter that owns it). There is no cross-project
 * token reuse. If no per-releaseId fetcher is registered, the call returns null
 * (byte-identical JIT fallback).
 *
 * @module release-assets/manifest-cache
 */

import { serverLogger } from "#veryfront/utils";
import { LRUCache } from "#veryfront/utils/lru-wrapper.ts";
import { registerLRUCache } from "#veryfront/cache/registry.ts";
import { getHostEnv } from "#veryfront/platform/compat/process.ts";
import { markRequestProfilePhase, profilePhase } from "#veryfront/observability";
import { RELEASE_ASSET_MANIFEST_ENV_FLAG } from "./constants.ts";
import { parseReleaseAssetManifest, type ReleaseAssetManifest } from "./manifest-schema.ts";

const logger = serverLogger.component("release-asset-manifest");

/** Bound on cached manifests (per releaseId:manifestVersion). */
const MAX_CACHED_MANIFESTS = 500;
/** Short TTL for non-ready / missing results (ms). */
const NON_READY_TTL_MS = 30_000;
/** Minimum delay before an awaited consumer can retry a cached non-ready result. */
const NON_READY_REVALIDATE_MS = 5_000;
/** TTL for ready manifests — long but finite so superseded entries are picked up (15 min). */
const READY_TTL_MS = 15 * 60 * 1000;
/** Background revalidation interval for ready manifests (1 min). */
const READY_REVALIDATE_MS = 60_000;

interface CacheEntry {
  manifest: ReleaseAssetManifest | null;
  /** Absolute expiry timestamp. */
  expiresAt: number;
  /** Absolute timestamp after which ready entries should refresh in the background. */
  refreshAfter?: number;
}

const manifestCache = new LRUCache<string, CacheEntry>({ maxEntries: MAX_CACHED_MANIFESTS });
registerLRUCache("release-asset-manifest-cache", manifestCache);

interface InFlightFetch {
  generation: number;
  token: symbol;
  promise: Promise<ReleaseAssetManifest | null>;
}

export interface ReadyManifestReadOptions {
  /**
   * Retry a cached non-ready result after a short throttle instead of waiting
   * for the full null TTL. Used by module responses that cannot be cached
   * safely until dependency imports can be rewritten through the manifest.
   */
  refreshCachedNull?: boolean;
}

/** In-flight fetches, deduped per releaseId. */
const inFlight = new Map<string, InFlightFetch>();
/** Monotonic guard that invalidates pending fetch writers after cache clears. */
let cacheGeneration = 0;

/**
 * Fetcher used to retrieve a manifest for a release. Registered per-releaseId
 * by the runtime adapter that owns that release, so the correct project-scoped
 * token is always used. Returns null when the manifest is unavailable.
 */
export interface ReleaseAssetManifestFetcher {
  (releaseId: string): Promise<
    { state: string; manifest: ReleaseAssetManifest | null } | null
  >;
}

/** Per-releaseId fetcher registry (keyed by releaseId). */
const fetcherRegistry = new Map<string, ReleaseAssetManifestFetcher>();
/** Registration revision closes ABA races when the same fetcher function is reused. */
const fetcherRevisions = new Map<string, number>();

function bumpFetcherRevision(registryKey: string): void {
  fetcherRevisions.set(registryKey, (fetcherRevisions.get(registryKey) ?? 0) + 1);
}

/**
 * Register a project-scoped manifest fetcher for the given releaseId.
 *
 * Called by the FS adapter when its content context is set to a release.
 * Overwrites any previous registration for the same releaseId (safe — the
 * latest adapter for a release is the authoritative owner).
 */
export function registerManifestFetcherForRelease(
  releaseId: string,
  fetcher: ReleaseAssetManifestFetcher,
): void {
  if (fetcherRegistry.get(releaseId) === fetcher) return;
  bumpFetcherRevision(releaseId);
  fetcherRegistry.set(releaseId, fetcher);
  invalidateReleaseManifestState(releaseId);
}

/**
 * Remove the manifest fetcher for the given releaseId.
 *
 * Called when an adapter transitions away from a release context.
 */
export function unregisterManifestFetcherForRelease(
  releaseId: string,
  expectedFetcher?: ReleaseAssetManifestFetcher,
): void {
  if (expectedFetcher && fetcherRegistry.get(releaseId) !== expectedFetcher) return;
  if (fetcherRegistry.delete(releaseId)) {
    bumpFetcherRevision(releaseId);
    invalidateReleaseManifestState(releaseId);
  }
}

/**
 * Register a single global fetcher (for tests / simple single-project setups).
 *
 * In production multi-tenant mode prefer `registerManifestFetcherForRelease`.
 * Passing `undefined` clears the global fallback.
 */
export function configureReleaseAssetManifestFetcher(
  fetcher: ReleaseAssetManifestFetcher | undefined,
): void {
  const previous = fetcherRegistry.get("*");
  if (previous === fetcher) return;
  bumpFetcherRevision("*");
  if (fetcher) {
    fetcherRegistry.set("*", fetcher);
  } else {
    fetcherRegistry.delete("*");
  }
  clearCachedReleaseAssetManifests();
}

/** Resolve the fetcher for a releaseId: prefer per-releaseId, then global fallback. */
interface FetcherRegistration {
  fetcher: ReleaseAssetManifestFetcher;
  registryKey: string;
  revision: number;
}

function resolveFetcherRegistration(
  releaseId: string,
): FetcherRegistration | undefined {
  const releaseFetcher = fetcherRegistry.get(releaseId);
  if (releaseFetcher) {
    return {
      fetcher: releaseFetcher,
      registryKey: releaseId,
      revision: fetcherRevisions.get(releaseId) ?? 0,
    };
  }

  const fallbackFetcher = fetcherRegistry.get("*");
  return fallbackFetcher
    ? {
      fetcher: fallbackFetcher,
      registryKey: "*",
      revision: fetcherRevisions.get("*") ?? 0,
    }
    : undefined;
}

function resolveFetcher(releaseId: string): ReleaseAssetManifestFetcher | undefined {
  return resolveFetcherRegistration(releaseId)?.fetcher;
}

function invalidateReleaseManifestState(releaseId: string): void {
  for (const [key] of manifestCache.entries()) {
    if (key === releaseId || key.startsWith(`${releaseId}:`)) manifestCache.delete(key);
  }
  inFlight.delete(releaseId);
}

/** True when production manifest consumption is enabled via env flag. */
export function isReleaseAssetManifestEnabled(): boolean {
  // Deployment-level flag: read HOST env explicitly. `getEnv` consults the
  // per-request project env overlay and refuses host fallthrough during remote
  // project renders, which left this flag permanently off in production.
  return getHostEnv(RELEASE_ASSET_MANIFEST_ENV_FLAG) === "1";
}

/** Build the cache key from releaseId + the latest known manifestVersion. */
function cacheKey(releaseId: string, manifestVersion?: number): string {
  return manifestVersion !== undefined ? `${releaseId}:${manifestVersion}` : releaseId;
}

function markManifestDecision(decision: string): void {
  markRequestProfilePhase(`release_manifest.${decision}`);
}

function findCachedReadyEntry(releaseId: string): CacheEntry | null {
  let best: CacheEntry | null = null;
  for (const [k, v] of manifestCache.entries()) {
    if (k !== releaseId && !k.startsWith(`${releaseId}:`)) continue;
    if (v.expiresAt > Date.now() && v.manifest) {
      const existingVersion = best?.manifest?.manifestVersion ?? -1;
      if ((v.manifest.manifestVersion ?? 0) > existingVersion) {
        best = v;
      }
    }
  }
  return best;
}

function maybeScheduleReadyRefresh(releaseId: string, entry: CacheEntry): void {
  const now = Date.now();
  if ((entry.refreshAfter ?? entry.expiresAt) <= now) {
    entry.refreshAfter = now + READY_REVALIDATE_MS;
    scheduleFetch(releaseId);
  }
}

/**
 * Return a ready manifest for `releaseId` if one is cached, else null.
 *
 * Non-blocking: on a cache miss (or expired entry) it schedules a background
 * fetch and returns null for the current render. Returns null immediately when
 * the flag is off or no fetcher is registered for this releaseId.
 */
export function getReadyManifestForRender(
  releaseId: string | null | undefined,
): ReleaseAssetManifest | null {
  if (!releaseId) {
    markManifestDecision("no_release_id");
    return null;
  }
  if (!isReleaseAssetManifestEnabled()) {
    markManifestDecision("disabled");
    return null;
  }
  if (!resolveFetcher(releaseId)) {
    markManifestDecision("no_fetcher");
    return null;
  }

  const best = findCachedReadyEntry(releaseId);
  if (best) {
    markManifestDecision("cached_ready");
    maybeScheduleReadyRefresh(releaseId, best);
    return best.manifest;
  }

  // Also check the plain releaseId slot (non-ready / null entry).
  const plain = manifestCache.get(releaseId);
  if (plain && plain.expiresAt > Date.now()) {
    // Non-ready entry still warm — return null without scheduling another fetch.
    markManifestDecision("cached_null");
    return null;
  }

  markManifestDecision("cache_miss");
  scheduleFetch(releaseId);
  return null;
}

/**
 * Await a ready manifest for `releaseId`.
 *
 * HTML generation uses this path so a cold process cannot emit a mixed shell
 * where preload hints see the manifest but the import map does not. It still
 * falls back to null when the flag is off, no fetcher is registered, the
 * manifest is unavailable, or the fetch fails.
 */
export async function getReadyManifestForRenderAsync(
  releaseId: string | null | undefined,
  options: ReadyManifestReadOptions = {},
): Promise<ReleaseAssetManifest | null> {
  if (!releaseId) {
    markManifestDecision("no_release_id");
    return null;
  }
  if (!isReleaseAssetManifestEnabled()) {
    markManifestDecision("disabled");
    return null;
  }
  if (!resolveFetcher(releaseId)) {
    markManifestDecision("no_fetcher");
    return null;
  }

  const best = findCachedReadyEntry(releaseId);
  if (best) {
    markManifestDecision("cached_ready");
    maybeScheduleReadyRefresh(releaseId, best);
    return best.manifest;
  }

  const now = Date.now();
  const plain = manifestCache.get(releaseId);
  if (plain && plain.expiresAt > now) {
    if (options.refreshCachedNull && (plain.refreshAfter ?? plain.expiresAt) <= now) {
      markManifestDecision("cached_null_refresh");
      return await fetchManifest(releaseId);
    }

    markManifestDecision("cached_null");
    return null;
  }

  return await fetchManifest(releaseId);
}

function scheduleFetch(releaseId: string): void {
  void fetchManifest(releaseId);
}

function fetchManifest(releaseId: string): Promise<ReleaseAssetManifest | null> {
  const existing = inFlight.get(releaseId);
  if (existing) {
    markManifestDecision("await_inflight");
    return existing.promise;
  }
  const registration = resolveFetcherRegistration(releaseId);
  if (!registration) {
    markManifestDecision("no_fetcher");
    return Promise.resolve(null);
  }
  const { fetcher: active } = registration;
  const fetchGeneration = cacheGeneration;
  const token = Symbol(releaseId);
  const registrationIsCurrent = (): boolean => {
    const currentRegistration = resolveFetcherRegistration(releaseId);
    return fetchGeneration === cacheGeneration &&
      currentRegistration?.fetcher === active &&
      currentRegistration.registryKey === registration.registryKey &&
      currentRegistration.revision === registration.revision;
  };

  const promise = profilePhase("release_manifest.fetch", async () => {
    try {
      const result = await active(releaseId);
      if (!registrationIsCurrent()) return null;

      if (!result) {
        markManifestDecision("fetch_missing");
        cacheNonReadyManifest(releaseId);
        return null;
      }

      const manifestState = normalizeManifestState(result.state);
      const manifest = isUsableManifestState(result.state) && result.manifest
        ? parseReleaseAssetManifest(result.manifest)
        : null;

      if (manifest) {
        if (manifest.releaseId !== releaseId) {
          markManifestDecision("fetch_identity_mismatch");
          cacheNonReadyManifest(releaseId);
          logger.warn("Rejected manifest with mismatched release identity", {
            requestedReleaseId: releaseId,
            manifestReleaseId: manifest.releaseId,
          });
          return null;
        }
        markManifestDecision(manifestState === "partial" ? "fetch_partial" : "fetch_ready");
        const key = cacheKey(releaseId, manifest.manifestVersion);
        manifestCache.set(key, {
          manifest,
          expiresAt: Date.now() + READY_TTL_MS,
          refreshAfter: Date.now() + READY_REVALIDATE_MS,
        });
        logger.debug("Cached ready manifest", {
          releaseId,
          manifestVersion: manifest.manifestVersion,
          state: result.state,
          ttlMs: READY_TTL_MS,
          refreshMs: READY_REVALIDATE_MS,
        });
        return manifest;
      } else {
        markManifestDecision(`fetch_${manifestState}`);
        markManifestDecision("fetch_not_ready");
        cacheNonReadyManifest(releaseId);
        return null;
      }
    } catch (error) {
      if (!registrationIsCurrent()) return null;
      logger.debug("Manifest fetch failed", {
        releaseId,
        error: error instanceof Error ? error.message : String(error),
      });
      markManifestDecision("fetch_failed");
      cacheNonReadyManifest(releaseId);
      return null;
    } finally {
      const current = inFlight.get(releaseId);
      if (current?.token === token && current.generation === fetchGeneration) {
        inFlight.delete(releaseId);
      }
    }
  });

  inFlight.set(releaseId, { generation: fetchGeneration, token, promise });
  return promise;
}

function isUsableManifestState(state: string): boolean {
  return state === "ready" || state === "partial";
}

function normalizeManifestState(state: string): string {
  return state.toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 32) || "unknown";
}

function cacheNonReadyManifest(releaseId: string): void {
  const now = Date.now();
  manifestCache.set(releaseId, {
    manifest: null,
    expiresAt: now + NON_READY_TTL_MS,
    refreshAfter: now + NON_READY_REVALIDATE_MS,
  });
}

/** Clear cached manifest bodies while keeping registered fetchers intact. */
export function clearCachedReleaseAssetManifests(): void {
  cacheGeneration++;
  manifestCache.clear();
  inFlight.clear();
}

/** Clear the cache and fetcher registry (tests / adapter teardown). */
export function clearReleaseAssetManifestCache(): void {
  clearCachedReleaseAssetManifests();
  fetcherRegistry.clear();
  fetcherRevisions.clear();
}
