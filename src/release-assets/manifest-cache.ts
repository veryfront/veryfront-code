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
 * The HTML shell is synchronous, so reads are non-blocking: a cache miss kicks
 * off a background fetch and returns null for the current render. Subsequent
 * renders for the same release pick up the cached result.
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
import { getEnv } from "#veryfront/platform/compat/process.ts";
import { RELEASE_ASSET_MANIFEST_ENV_FLAG } from "./constants.ts";
import { parseReleaseAssetManifest, type ReleaseAssetManifest } from "./manifest-schema.ts";

const logger = serverLogger.component("release-asset-manifest");

/** Bound on cached manifests (per releaseId:manifestVersion). */
const MAX_CACHED_MANIFESTS = 500;
/** Short TTL for non-ready / missing results (ms). */
const NON_READY_TTL_MS = 30_000;
/** TTL for ready manifests — long but finite so superseded entries are picked up (15 min). */
const READY_TTL_MS = 15 * 60 * 1000;

interface CacheEntry {
  manifest: ReleaseAssetManifest | null;
  /** Absolute expiry timestamp. */
  expiresAt: number;
}

const manifestCache = new LRUCache<string, CacheEntry>({ maxEntries: MAX_CACHED_MANIFESTS });
registerLRUCache("release-asset-manifest-cache", manifestCache);

/** In-flight fetches, deduped per releaseId. */
const inFlight = new Map<string, Promise<void>>();

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
  return getEnv(RELEASE_ASSET_MANIFEST_ENV_FLAG) === "1";
}

/** Build the cache key from releaseId + the latest known manifestVersion. */
function cacheKey(releaseId: string, manifestVersion?: number): string {
  return manifestVersion !== undefined ? `${releaseId}:${manifestVersion}` : releaseId;
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

  // Look up the most recent cached entry for this release. We do a prefix scan
  // of the LRU to find any `releaseId:*` entry; if we find a live ready one we
  // return it without scheduling another fetch.
  let best: CacheEntry | null = null;
  for (const [k, v] of manifestCache.entries()) {
    if (k !== releaseId && !k.startsWith(`${releaseId}:`)) continue;
    if (v.expiresAt > Date.now() && v.manifest) {
      // Prefer the entry with the highest manifest version.
      const existingVersion = best?.manifest?.manifestVersion ?? -1;
      if ((v.manifest.manifestVersion ?? 0) > existingVersion) {
        best = v;
      }
    }
  }

  if (best) return best.manifest;

  // Also check the plain releaseId slot (non-ready / null entry).
  const plain = manifestCache.get(releaseId);
  if (plain && plain.expiresAt > Date.now()) {
    // Non-ready entry still warm — return null without scheduling another fetch.
    return null;
  }

  scheduleFetch(releaseId);
  return null;
}

function scheduleFetch(releaseId: string): void {
  if (inFlight.has(releaseId)) return;
  const active = resolveFetcher(releaseId);
  if (!active) return;

  const promise = (async () => {
    try {
      const result = await active(releaseId);
      if (!result) {
        manifestCache.set(releaseId, { manifest: null, expiresAt: Date.now() + NON_READY_TTL_MS });
        return;
      }

      const manifest = result.state === "ready" && result.manifest
        ? parseReleaseAssetManifest(result.manifest)
        : null;

      if (manifest) {
        const key = cacheKey(releaseId, manifest.manifestVersion);
        manifestCache.set(key, { manifest, expiresAt: Date.now() + READY_TTL_MS });
        logger.debug("Cached ready manifest", {
          releaseId,
          manifestVersion: manifest.manifestVersion,
          ttlMs: READY_TTL_MS,
        });
      } else {
        manifestCache.set(releaseId, {
          manifest: null,
          expiresAt: Date.now() + NON_READY_TTL_MS,
        });
      }
    } catch (error) {
      logger.debug("Manifest fetch failed", {
        releaseId,
        error: error instanceof Error ? error.message : String(error),
      });
      manifestCache.set(releaseId, { manifest: null, expiresAt: Date.now() + NON_READY_TTL_MS });
    } finally {
      inFlight.delete(releaseId);
    }
  })();

  inFlight.set(releaseId, promise);
}

/** Clear the cache (deployment / memory pressure / tests). */
export function clearReleaseAssetManifestCache(): void {
  manifestCache.clear();
  inFlight.clear();
  fetcherRegistry.clear();
}
