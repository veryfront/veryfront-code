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
import { registerLRUCache } from "#veryfront/cache";
import { getHostEnv } from "#veryfront/platform/compat/process.ts";
import { RELEASE_ASSET_MANIFEST_ENV_FLAG } from "./constants.ts";
import { parseReleaseAssetManifest, type ReleaseAssetManifest } from "./manifest-schema.ts";

const logger = serverLogger.component("release-asset-manifest");

/** Bound on cached manifests (per releaseId:manifestVersion). */
const MAX_CACHED_MANIFESTS = 500;
/** Short TTL for non-ready / missing results (ms). */
const NON_READY_TTL_MS = 30_000;
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
  fetcherRegistry.set(releaseId, fetcher);
}

/**
 * Remove the manifest fetcher for the given releaseId.
 *
 * Called when an adapter transitions away from a release context.
 */
export function unregisterManifestFetcherForRelease(releaseId: string): void {
  fetcherRegistry.delete(releaseId);
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
  if (fetcher) {
    fetcherRegistry.set("*", fetcher);
  } else {
    fetcherRegistry.delete("*");
  }
}

/** Resolve the fetcher for a releaseId: prefer per-releaseId, then global fallback. */
function resolveFetcher(
  releaseId: string,
): ReleaseAssetManifestFetcher | undefined {
  return fetcherRegistry.get(releaseId) ?? fetcherRegistry.get("*");
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
  if (!releaseId) return null;
  if (!isReleaseAssetManifestEnabled()) return null;
  if (!resolveFetcher(releaseId)) return null;

  const best = findCachedReadyEntry(releaseId);
  if (best) {
    maybeScheduleReadyRefresh(releaseId, best);
    return best.manifest;
  }

  // Also check the plain releaseId slot (non-ready / null entry).
  const plain = manifestCache.get(releaseId);
  if (plain && plain.expiresAt > Date.now()) {
    // Non-ready entry still warm — return null without scheduling another fetch.
    return null;
  }

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
): Promise<ReleaseAssetManifest | null> {
  if (!releaseId) return null;
  if (!isReleaseAssetManifestEnabled()) return null;
  if (!resolveFetcher(releaseId)) return null;

  const best = findCachedReadyEntry(releaseId);
  if (best) {
    maybeScheduleReadyRefresh(releaseId, best);
    return best.manifest;
  }

  const plain = manifestCache.get(releaseId);
  if (plain && plain.expiresAt > Date.now()) return null;

  return await fetchManifest(releaseId);
}

function scheduleFetch(releaseId: string): void {
  void fetchManifest(releaseId);
}

function fetchManifest(releaseId: string): Promise<ReleaseAssetManifest | null> {
  const existing = inFlight.get(releaseId);
  if (existing) return existing.promise;
  const active = resolveFetcher(releaseId);
  if (!active) return Promise.resolve(null);
  const fetchGeneration = cacheGeneration;
  const token = Symbol(releaseId);

  const promise = Promise.resolve().then(async () => {
    try {
      const result = await active(releaseId);
      if (fetchGeneration !== cacheGeneration) return null;

      if (!result) {
        manifestCache.set(releaseId, { manifest: null, expiresAt: Date.now() + NON_READY_TTL_MS });
        return null;
      }

      const manifest = result.state === "ready" && result.manifest
        ? parseReleaseAssetManifest(result.manifest)
        : null;

      if (manifest) {
        const key = cacheKey(releaseId, manifest.manifestVersion);
        manifestCache.set(key, {
          manifest,
          expiresAt: Date.now() + READY_TTL_MS,
          refreshAfter: Date.now() + READY_REVALIDATE_MS,
        });
        logger.debug("Cached ready manifest", {
          releaseId,
          manifestVersion: manifest.manifestVersion,
          ttlMs: READY_TTL_MS,
          refreshMs: READY_REVALIDATE_MS,
        });
        return manifest;
      } else {
        manifestCache.set(releaseId, {
          manifest: null,
          expiresAt: Date.now() + NON_READY_TTL_MS,
        });
        return null;
      }
    } catch (error) {
      logger.debug("Manifest fetch failed", {
        releaseId,
        error: error instanceof Error ? error.message : String(error),
      });
      if (fetchGeneration !== cacheGeneration) return null;
      manifestCache.set(releaseId, { manifest: null, expiresAt: Date.now() + NON_READY_TTL_MS });
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
}
