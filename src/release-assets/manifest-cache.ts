/**
 * Release Asset Manifest — in-process consumption cache (production HTML).
 *
 * Fetches manifests from the project-scoped GET endpoint once per release and
 * caches them keyed by releaseId. Ready manifests are immutable and cached
 * indefinitely; non-ready / missing results are cached for a short TTL so the
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
 * @module release-assets/manifest-cache
 */

import { serverLogger } from "#veryfront/utils";
import { LRUCache } from "#veryfront/utils/lru-wrapper.ts";
import { registerLRUCache } from "#veryfront/cache";
import { getEnv } from "#veryfront/platform/compat/process.ts";
import { RELEASE_ASSET_MANIFEST_ENV_FLAG } from "./constants.ts";
import {
  parseReleaseAssetManifest,
  type ReleaseAssetManifest,
} from "./manifest-schema.ts";

const logger = serverLogger.component("release-asset-manifest");

/** Bound on cached manifests (per releaseId). */
const MAX_CACHED_MANIFESTS = 500;
/** Short TTL for non-ready / missing results (ms). */
const NON_READY_TTL_MS = 30_000;

interface CacheEntry {
  manifest: ReleaseAssetManifest | null;
  /** Absolute expiry timestamp; Infinity for ready (immutable) manifests. */
  expiresAt: number;
}

const manifestCache = new LRUCache<string, CacheEntry>({ maxEntries: MAX_CACHED_MANIFESTS });
registerLRUCache("release-asset-manifest-cache", manifestCache);

/** In-flight fetches, deduped per releaseId. */
const inFlight = new Map<string, Promise<void>>();

/**
 * Fetcher used to retrieve a manifest for a release. Injected by the runtime
 * (which holds the project-scoped API client / token). When unset, consumption
 * is inert (returns null), preserving today's behavior.
 */
export interface ReleaseAssetManifestFetcher {
  (releaseId: string): Promise<
    { state: string; manifest: ReleaseAssetManifest | null } | null
  >;
}

let fetcher: ReleaseAssetManifestFetcher | undefined;

/** Register the manifest fetcher. Called once during runtime adapter setup. */
export function configureReleaseAssetManifestFetcher(
  next: ReleaseAssetManifestFetcher | undefined,
): void {
  fetcher = next;
}

/** True when production manifest consumption is enabled via env flag. */
export function isReleaseAssetManifestEnabled(): boolean {
  return getEnv(RELEASE_ASSET_MANIFEST_ENV_FLAG) === "1";
}

/**
 * Return a ready manifest for `releaseId` if one is cached, else null.
 *
 * Non-blocking: on a cache miss (or expired non-ready entry) it schedules a
 * background fetch and returns null for the current render. Returns null
 * immediately when the flag is off or no fetcher is registered.
 */
export function getReadyManifestForRender(
  releaseId: string | null | undefined,
): ReleaseAssetManifest | null {
  if (!releaseId) return null;
  if (!isReleaseAssetManifestEnabled()) return null;
  if (!fetcher) return null;

  const entry = manifestCache.get(releaseId);
  if (entry) {
    if (entry.expiresAt === Infinity) return entry.manifest;
    if (entry.expiresAt > Date.now()) return entry.manifest;
    // expired non-ready entry — fall through to refresh
  }

  scheduleFetch(releaseId);
  return entry?.manifest ?? null;
}

function scheduleFetch(releaseId: string): void {
  if (inFlight.has(releaseId)) return;
  const active = fetcher;
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
        manifestCache.set(releaseId, { manifest, expiresAt: Infinity });
        logger.debug("Cached ready manifest", {
          releaseId,
          manifestVersion: manifest.manifestVersion,
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
}
