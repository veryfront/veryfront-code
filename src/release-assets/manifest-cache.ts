/**
 * Release Asset Manifest — in-process consumption cache (production HTML).
 *
 * Fetches manifests from the project-scoped GET endpoint once per release and
 * caches them under collision-free release/version tuple identities. Ready manifests are
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

import { serverLogger } from "#veryfront/utils/logger/index.ts";
import { LRUCache } from "#veryfront/utils/lru-wrapper.ts";
import { registerLRUCache } from "#veryfront/cache";
import { getHostEnv } from "#veryfront/platform/compat/process.ts";
import { isErrorAcrossRealms } from "#veryfront/platform/compat/error-introspection.ts";
import { markRequestProfilePhase, profilePhase } from "#veryfront/observability";
import { RELEASE_ASSET_MANIFEST_ENV_FLAG, RELEASE_ASSET_MANIFEST_LIMITS } from "./constants.ts";
import {
  describeReadyReleaseAssetManifestRejection,
  parseReadyReleaseAssetManifestResponse,
  type ReleaseAssetManifest,
} from "./manifest-schema.ts";
import { hasControlCharacters } from "./string-validation.ts";

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
/** A manifest fetch must not hold an HTML render or in-flight slot forever. */
const MANIFEST_FETCH_TIMEOUT_MS = 10_000;
const MAX_REGISTERED_FETCHERS = 10_000;

interface CacheEntry {
  releaseId: string;
  ownerToken: symbol;
  manifest: ReleaseAssetManifest | null;
  /** Absolute expiry timestamp. */
  expiresAt: number;
  /** Absolute timestamp after which ready entries should refresh in the background. */
  refreshAfter?: number;
}

const manifestCache = new LRUCache<string, CacheEntry>({ maxEntries: MAX_CACHED_MANIFESTS });
registerLRUCache("release-asset-manifest-cache", manifestCache);

interface InFlightFetch {
  generation: symbol;
  token: symbol;
  ownerToken: symbol;
  controller: AbortController;
  promise: Promise<ReleaseAssetManifest | null>;
}

/** Controls revalidation behavior for awaited manifest reads. */
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
let cacheGeneration = Symbol("release-asset-manifest-cache-generation");

/** Cancellation context passed to a release-scoped manifest fetcher. */
export interface ReleaseAssetManifestFetchContext {
  /** Aborted when the fetch times out or its fetcher loses ownership. */
  readonly signal: AbortSignal;
}

/** Untrusted control-plane response returned by a registered fetcher. */
export interface ReleaseAssetManifestFetchResult {
  readonly state: string;
  readonly manifest_version: number;
  readonly manifest: unknown;
}

/**
 * Fetcher used to retrieve a manifest for a release. Registered per-releaseId
 * by the runtime adapter that owns that release, so the correct project-scoped
 * token is always used. Returns null when the manifest is unavailable.
 */
export interface ReleaseAssetManifestFetcher {
  (
    releaseId: string,
    context: ReleaseAssetManifestFetchContext,
  ): Promise<ReleaseAssetManifestFetchResult | null>;
}

/** Idempotent cleanup for one fetcher registration. */
export type ReleaseAssetManifestFetcherCleanup = () => void;

interface FetcherRegistration {
  fetcher: ReleaseAssetManifestFetcher;
  token: symbol;
}

/** Per-releaseId fetcher registry (keyed by releaseId). */
const fetcherRegistry = new Map<string, FetcherRegistration>();

function isValidReleaseId(value: unknown): value is string {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= RELEASE_ASSET_MANIFEST_LIMITS.identifierLength &&
    value.trim() === value &&
    !hasControlCharacters(value);
}

function requireValidReleaseId(value: string): string {
  if (!isValidReleaseId(value)) {
    throw new TypeError(
      `releaseId must be non-empty, trimmed text up to ${RELEASE_ASSET_MANIFEST_LIMITS.identifierLength} characters`,
    );
  }
  return value;
}

function retireStaleInFlightFetches(): void {
  for (const [releaseId, fetch] of inFlight) {
    if (fetcherRegistry.get(releaseId)?.token === fetch.ownerToken) continue;
    inFlight.delete(releaseId);
    fetch.controller.abort(new Error("Release manifest fetcher ownership changed"));
  }
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
): ReleaseAssetManifestFetcherCleanup {
  const validReleaseId = requireValidReleaseId(releaseId);
  if (typeof fetcher !== "function") {
    throw new TypeError("Manifest fetcher must be a function");
  }
  if (
    !fetcherRegistry.has(validReleaseId) &&
    fetcherRegistry.size >= MAX_REGISTERED_FETCHERS
  ) {
    throw new Error(`Manifest fetcher registry is limited to ${MAX_REGISTERED_FETCHERS} releases`);
  }
  const registration: FetcherRegistration = {
    fetcher,
    token: Symbol(validReleaseId),
  };
  fetcherRegistry.set(validReleaseId, registration);
  retireStaleInFlightFetches();
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    if (fetcherRegistry.get(validReleaseId)?.token === registration.token) {
      fetcherRegistry.delete(validReleaseId);
      retireStaleInFlightFetches();
    }
  };
}

/**
 * Remove the manifest fetcher for the given releaseId.
 *
 * This is an unconditional administrative removal. Adapter owners should use
 * the cleanup returned by `registerManifestFetcherForRelease` so an older
 * adapter cannot remove a newer registration for the same release.
 */
export function unregisterManifestFetcherForRelease(releaseId: string): void {
  fetcherRegistry.delete(requireValidReleaseId(releaseId));
  retireStaleInFlightFetches();
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
  return JSON.stringify([releaseId, manifestVersion ?? null]);
}

function markManifestDecision(decision: string): void {
  markRequestProfilePhase(`release_manifest.${decision}`);
}

function findCachedReadyEntry(releaseId: string, ownerToken: symbol): CacheEntry | null {
  let best: CacheEntry | null = null;
  for (const [, v] of manifestCache.entries()) {
    if (v.releaseId !== releaseId || v.ownerToken !== ownerToken) continue;
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

function evictReadyManifests(releaseId: string, ownerToken: symbol): void {
  const keys: string[] = [];
  for (const [key, entry] of manifestCache.entries()) {
    if (entry.releaseId === releaseId && entry.ownerToken === ownerToken && entry.manifest) {
      keys.push(key);
    }
  }
  for (const key of keys) manifestCache.delete(key);
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
  if (!isValidReleaseId(releaseId)) {
    markManifestDecision("invalid_release_id");
    return null;
  }
  if (!isReleaseAssetManifestEnabled()) {
    markManifestDecision("disabled");
    return null;
  }
  const activeFetcher = fetcherRegistry.get(releaseId);
  if (!activeFetcher) {
    markManifestDecision("no_fetcher");
    return null;
  }

  const best = findCachedReadyEntry(releaseId, activeFetcher.token);
  if (best) {
    markManifestDecision("cached_ready");
    maybeScheduleReadyRefresh(releaseId, best);
    return best.manifest;
  }

  // Also check the plain releaseId slot (non-ready / null entry).
  const plain = manifestCache.get(cacheKey(releaseId));
  if (
    plain &&
    plain.ownerToken === activeFetcher.token &&
    plain.expiresAt > Date.now()
  ) {
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
async function getReadyManifestAsync(
  releaseId: string | null | undefined,
  options: ReadyManifestReadOptions = {},
): Promise<ReleaseAssetManifest | null> {
  if (!releaseId) {
    markManifestDecision("no_release_id");
    return null;
  }
  if (!isValidReleaseId(releaseId)) {
    markManifestDecision("invalid_release_id");
    return null;
  }
  const activeFetcher = fetcherRegistry.get(releaseId);
  if (!activeFetcher) {
    markManifestDecision("no_fetcher");
    return null;
  }

  const best = findCachedReadyEntry(releaseId, activeFetcher.token);
  if (best) {
    markManifestDecision("cached_ready");
    maybeScheduleReadyRefresh(releaseId, best);
    return best.manifest;
  }

  const now = Date.now();
  const plain = manifestCache.get(cacheKey(releaseId));
  if (
    plain &&
    plain.ownerToken === activeFetcher.token &&
    plain.expiresAt > now
  ) {
    if (options.refreshCachedNull && (plain.refreshAfter ?? plain.expiresAt) <= now) {
      markManifestDecision("cached_null_refresh");
      return await fetchManifest(releaseId);
    }

    markManifestDecision("cached_null");
    return null;
  }

  return await fetchManifest(releaseId);
}

/**
 * Await a ready manifest for rendering when release-manifest consumption is
 * enabled.
 */
export async function getReadyManifestForRenderAsync(
  releaseId: string | null | undefined,
  options: ReadyManifestReadOptions = {},
): Promise<ReleaseAssetManifest | null> {
  if (!isReleaseAssetManifestEnabled()) {
    markManifestDecision("disabled");
    return null;
  }
  return await getReadyManifestAsync(releaseId, options);
}

/**
 * Resolve the release manifest used as the production browser-module admission
 * boundary. Unlike rendering optimizations, this security decision is never
 * controlled by the release-manifest rollout flag.
 */
export async function getReadyManifestForBrowserModuleAdmission(
  releaseId: string | null | undefined,
  options: ReadyManifestReadOptions = {},
): Promise<ReleaseAssetManifest | null> {
  return await getReadyManifestAsync(releaseId, options);
}

function scheduleFetch(releaseId: string): void {
  void fetchManifest(releaseId);
}

function fetchManifest(releaseId: string): Promise<ReleaseAssetManifest | null> {
  const active = fetcherRegistry.get(releaseId);
  if (!active) {
    markManifestDecision("no_fetcher");
    return Promise.resolve(null);
  }
  const existing = inFlight.get(releaseId);
  if (
    existing &&
    existing.generation === cacheGeneration &&
    existing.ownerToken === active.token
  ) {
    markManifestDecision("await_inflight");
    return existing.promise;
  }
  if (existing) {
    inFlight.delete(releaseId);
    existing.controller.abort(new Error("Release manifest fetch superseded"));
  }
  const fetchGeneration = cacheGeneration;
  const token = Symbol(releaseId);
  const controller = new AbortController();

  const promise = profilePhase("release_manifest.fetch", async () => {
    try {
      const result = await invokeManifestFetcher(active, releaseId, controller);
      if (!isCurrentFetchOwner(releaseId, fetchGeneration, active.token)) return null;

      if (!result) {
        markManifestDecision("fetch_missing");
        evictReadyManifests(releaseId, active.token);
        cacheNonReadyManifest(releaseId, active.token);
        return null;
      }

      const rawState = readOwnDataProperty(result, "state");
      const rawManifestVersion = readOwnDataProperty(result, "manifest_version");
      const state = typeof rawState === "string" && rawState.length <= 64 &&
          typeof rawManifestVersion === "number" &&
          Number.isSafeInteger(rawManifestVersion) &&
          rawManifestVersion >= 0
        ? rawState
        : "invalid";
      const manifestState = normalizeManifestState(state);
      const readyResponse = isUsableManifestState(state)
        // Runtime reads serve releases published before the v2 move, so they
        // must accept the v1 body still in storage. Producer-side callers
        // (build executor, CLI deploy wait) deliberately do not.
        ? parseReadyReleaseAssetManifestResponse(result, releaseId, { acceptLegacyV1: true })
        : null;
      const manifest = readyResponse?.manifest ?? null;

      if (manifest) {
        markManifestDecision("fetch_ready");
        const key = cacheKey(releaseId, manifest.manifestVersion);
        manifestCache.set(key, {
          releaseId,
          ownerToken: active.token,
          manifest,
          expiresAt: Date.now() + READY_TTL_MS,
          refreshAfter: Date.now() + READY_REVALIDATE_MS,
        });
        logger.debug("Cached ready manifest", {
          releaseId,
          manifestVersion: manifest.manifestVersion,
          state,
          ttlMs: READY_TTL_MS,
          refreshMs: READY_REVALIDATE_MS,
        });
        return manifest;
      } else {
        // Classify on what the publisher claimed, not on the derived `state`.
        // A response that says `ready` with an unusable `manifest_version` is
        // normalized to "invalid" above, so keying on `state` would route the
        // envelope-level rejections to debug — silencing exactly the reasons
        // this diagnostic exists to surface.
        if (rawState === "ready") {
          markManifestDecision("fetch_ready_invalid");
          // A manifest the publisher calls ready but this build cannot read is
          // an operator problem, not a wait: browser modules are refused for
          // the whole release until someone acts. Say why. Without this the
          // only signal is a 503 and a timing mark, which cannot distinguish
          // framework version skew from a corrupt payload.
          logger.error("Release manifest is ready upstream but failed validation", {
            releaseId,
            // Same acceptance as the parse above, so the reason describes what
            // this caller actually rejected.
            reason: describeReadyReleaseAssetManifestRejection(result, releaseId, {
              acceptLegacyV1: true,
            }),
          });
        } else {
          markManifestDecision(`fetch_${manifestState}`);
          // Any other state is the release legitimately not being ready yet.
          logger.debug("Release manifest is not ready", { releaseId, state: manifestState });
        }
        markManifestDecision("fetch_not_ready");
        evictReadyManifests(releaseId, active.token);
        cacheNonReadyManifest(releaseId, active.token);
        return null;
      }
    } catch (error) {
      if (!isCurrentFetchOwner(releaseId, fetchGeneration, active.token)) return null;
      logger.debug("Manifest fetch failed", {
        releaseId,
        error: error instanceof Error ? error.message : String(error),
      });
      markManifestDecision("fetch_failed");
      cacheNonReadyManifest(releaseId, active.token);
      return null;
    } finally {
      const current = inFlight.get(releaseId);
      if (
        current?.token === token &&
        current.generation === fetchGeneration &&
        current.ownerToken === active.token
      ) {
        inFlight.delete(releaseId);
      }
    }
  });

  inFlight.set(releaseId, {
    generation: fetchGeneration,
    token,
    ownerToken: active.token,
    controller,
    promise,
  });
  return promise;
}

function isCurrentFetchOwner(
  releaseId: string,
  generation: symbol,
  ownerToken: symbol,
): boolean {
  return generation === cacheGeneration &&
    fetcherRegistry.get(releaseId)?.token === ownerToken;
}

async function invokeManifestFetcher(
  registration: FetcherRegistration,
  releaseId: string,
  controller: AbortController,
): Promise<ReleaseAssetManifestFetchResult | null> {
  if (controller.signal.aborted) {
    const reason = controller.signal.reason;
    throw isErrorAcrossRealms(reason) ? reason : new Error("Release manifest fetch aborted");
  }

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let abortListener: (() => void) | undefined;
  const cancellation = new Promise<never>((_resolve, reject) => {
    abortListener = () => {
      const reason = controller.signal.reason;
      reject(isErrorAcrossRealms(reason) ? reason : new Error("Release manifest fetch aborted"));
    };
    controller.signal.addEventListener("abort", abortListener, { once: true });
    timeoutId = setTimeout(() => {
      controller.abort(
        new Error(`Release manifest fetch exceeded ${MANIFEST_FETCH_TIMEOUT_MS}ms`),
      );
    }, MANIFEST_FETCH_TIMEOUT_MS);
  });

  try {
    return await Promise.race([
      Promise.resolve().then(() => registration.fetcher(releaseId, { signal: controller.signal })),
      cancellation,
    ]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    if (abortListener) controller.signal.removeEventListener("abort", abortListener);
  }
}

function isUsableManifestState(state: string): boolean {
  return state === "ready";
}

function readOwnDataProperty(value: unknown, key: PropertyKey): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && "value" in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

function normalizeManifestState(state: string): string {
  return state.slice(0, 64).toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 32) ||
    "unknown";
}

function cacheNonReadyManifest(releaseId: string, ownerToken: symbol): void {
  const now = Date.now();
  manifestCache.set(cacheKey(releaseId), {
    releaseId,
    ownerToken,
    manifest: null,
    expiresAt: now + NON_READY_TTL_MS,
    refreshAfter: now + NON_READY_REVALIDATE_MS,
  });
}

/** Clear cached manifest bodies while keeping registered fetchers intact. */
export function clearCachedReleaseAssetManifests(): void {
  cacheGeneration = Symbol("release-asset-manifest-cache-generation");
  manifestCache.clear();
  for (const fetch of inFlight.values()) {
    fetch.controller.abort(new Error("Release manifest cache cleared"));
  }
  inFlight.clear();
}

/** Clear the cache and fetcher registry (tests / adapter teardown). */
export function clearReleaseAssetManifestCache(): void {
  clearCachedReleaseAssetManifests();
  fetcherRegistry.clear();
}
