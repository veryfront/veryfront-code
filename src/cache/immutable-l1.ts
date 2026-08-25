/**
 * Process-local L1 tier for immutable, release-scoped file cache entries.
 *
 * `FileCache` reaches the distributed backend once per key per request, so an
 * immutable release asset costs one HTTP round trip every time any request
 * touches it. This module holds those values in process between requests.
 *
 * It sits in front of `ApiCacheBackend`'s per-request credential gate, and that
 * gate only establishes that a token is PRESENT. Validity is decided server
 * side by the very call an L1 hit skips. So an L1 hit is served without
 * revalidation, and no keying scheme changes that. Four bounds contain it:
 *
 *  1. only immutable release-scoped keys are admitted, never branch-scoped ones
 *  2. entries are scoped on the credential identity and project reference the
 *     backend read would have used, so no entry crosses a project or a credential
 *  3. a short TTL bounds how long a revoked credential can keep reading, and how
 *     far a publish on another pod can lag behind
 *  4. entry-count, per-value and total-byte ceilings bound what the tier can
 *     cost the process, because the values it holds are file CONTENT
 *
 * @module cache/immutable-l1
 */

import { logger as baseLogger } from "#veryfront/utils";
import { getEnvValue } from "./backends/helpers.ts";
import {
  cacheCredentialIdentity,
  resolveCacheRequestAuthority,
  type ResolvedCacheAuthority,
} from "./request-authority.ts";

const logger = baseLogger.component("immutable-l1");

/**
 * How long an admitted entry may be served without the backend being consulted
 * again.
 *
 * This is a security bound, not a performance tuning value, and it bounds two
 * separate things at once. Raising it widens both linearly.
 *
 *  1. An L1 hit performs no server-side authorization, so this is the upper
 *     bound on how long a credential revoked mid-flight can keep reading
 *     release assets of a project it was already authorized for.
 *  2. `file:release:` keys are immutable by construction but not immutable in
 *     operation: a publish poke wipes the whole `file:release:` prefix
 *     (`platform/adapters/fs/veryfront/websocket-manager.ts`). That wipe drops
 *     the L1 entries of the pod that received the poke, and nothing else. Every
 *     other pod keeps serving its warm entries until they expire, so this is
 *     also the upper bound on cross-pod publish-invalidation lag: raising it
 *     delays how long a publish takes to become visible on pods that did not
 *     handle the poke.
 */
export const IMMUTABLE_L1_DEFAULT_TTL_MS = 5_000;

/**
 * Hard upper bound on the configured entry lifetime, applied to
 * `IMMUTABLE_L1_TTL_ENV_VAR` after parsing.
 *
 * The TTL is not a performance knob that only costs staleness when it is set
 * too high. It is the width of two separate windows at once, and a clamp is
 * what keeps a typo from widening either of them without bound:
 *
 *  1. CREDENTIAL REVOCATION. An L1 hit is served with no server-side
 *     authorization, so a credential revoked mid-flight keeps reading release
 *     assets of a project it was already authorized for for up to this long.
 *  2. CROSS-POD PUBLISH VISIBILITY. A publish poke drops the `file:release:`
 *     entries of the pod that received it and of no other, so every other pod
 *     keeps serving warm entries until they expire. This is the upper bound on
 *     how long a publish stays invisible on pods that did not handle the poke.
 *
 * Without a clamp, `VERYFRONT_FILE_CACHE_L1_TTL_MS=5000000` parses cleanly and
 * silently buys 83 minutes of BOTH windows in place of the intended 5 seconds.
 * 60 seconds is the outer edge at which both remain defensible operationally:
 * it is twelve times the default, so it leaves real room to trade round trips
 * for staleness, while keeping revocation lag and publish lag inside the minute
 * an operator would already tolerate from a rolling restart.
 */
export const IMMUTABLE_L1_MAX_TTL_MS = 60_000;

/** Entry-count ceiling, so the store cannot grow without limit. */
export const IMMUTABLE_L1_DEFAULT_MAX_ENTRIES = 2_000;

/**
 * Per-value ceiling. A value larger than this is never admitted.
 *
 * The entry-count ceiling alone bounds nothing that matters here, because the
 * values are file CONTENT and a single release asset can be arbitrarily large:
 * 2000 entries of a 64 MB asset is 128 GB. A per-value ceiling is the half of
 * the bound that keeps one large asset from displacing the entire working set
 * this tier exists to hold, and it is checked BEFORE insertion so an oversized
 * value is never materialized into the store at all.
 *
 * 512 KiB is well above the source and asset files whose per-request round trip
 * this tier is meant to remove, and far below the size at which one entry would
 * dominate the process.
 */
export const IMMUTABLE_L1_DEFAULT_MAX_VALUE_BYTES = 512 * 1024;

/**
 * Total-bytes ceiling across every scope, enforced by evicting in LRU order
 * until the store is back under it.
 *
 * This is the half of the bound that caps the tier's worst case outright, so a
 * project with many mid-sized release assets cannot exhaust the process by
 * staying under the per-value ceiling 2000 times over. 64 MiB is the retained
 * worst case with these defaults.
 */
export const IMMUTABLE_L1_DEFAULT_MAX_TOTAL_BYTES = 64 * 1024 * 1024;

/**
 * Overrides the TTL above. Set to `0` to disable the tier outright. Values
 * above `IMMUTABLE_L1_MAX_TTL_MS` are clamped to it, with a warning.
 */
export const IMMUTABLE_L1_TTL_ENV_VAR = "VERYFRONT_FILE_CACHE_L1_TTL_MS";

/** Overrides the entry-count ceiling above. Set to `0` to admit nothing. */
export const IMMUTABLE_L1_MAX_ENTRIES_ENV_VAR = "VERYFRONT_FILE_CACHE_L1_MAX_ENTRIES";

/** Overrides the per-value ceiling above. Set to `0` to admit nothing. */
export const IMMUTABLE_L1_MAX_VALUE_BYTES_ENV_VAR = "VERYFRONT_FILE_CACHE_L1_MAX_VALUE_BYTES";

/** Overrides the total-bytes ceiling above. Set to `0` to admit nothing. */
export const IMMUTABLE_L1_MAX_TOTAL_BYTES_ENV_VAR = "VERYFRONT_FILE_CACHE_L1_MAX_TOTAL_BYTES";

/**
 * Bytes charged per UTF-16 code unit of a held value.
 *
 * Matches the `estimateSize` convention already used by the file cache: an
 * O(1) upper bound on what V8 retains for the string, rather than an O(n)
 * re-encode on every admission.
 */
const BYTES_PER_VALUE_CHAR = 2;

/**
 * Separates scope from cache key. A NUL is used because no cache key or
 * project reference the key builders can produce contains one, so a scope
 * boundary cannot be forged by crafting a key. Admission refuses any key
 * that holds one anyway.
 */
const SCOPE_SEPARATOR = "\u0000";

/**
 * The only admissible source identity.
 *
 * `buildFileOperationPrefix` emits `file:<sourceTypeKey>:<projectSlug>:<qualifier>`
 * and a concrete key appends the path. `release` is the one identity whose
 * qualifier is the release id itself, so the value behind a given key never
 * changes: activating another release produces a different key rather than new
 * content under the old one.
 *
 * `branch` keys are exactly the mutable ones and must always reach the backend.
 * `env` keys pin a release id too, but they are deliberately left out: this tier
 * fails closed, and only the shape that has been reasoned about is admitted.
 */
const IMMUTABLE_KEY_PREFIX = "file:release:";

/** Segments before the path: `file`, `release`, projectSlug, releaseId. */
const IMMUTABLE_KEY_PREFIX_SEGMENTS = 4;

/**
 * True only for a concrete immutable release-scoped file cache key.
 *
 * Anchored on the literal prefix rather than scanning for a `release` segment
 * anywhere, because a project slug or a file path containing `release` must not
 * be able to qualify a mutable key. Every other shape is refused: branch keys,
 * `env` keys, `stat`/`dir`/`files` keys, the `file:unknown` no-context
 * fallback, prefixes with no path, and anything unrecognized.
 *
 * Known imprecision, deliberately left as is. `buildFileOperationPrefix`
 * (`cache/keys/builders/file.ts`) interpolates `projectSlug` raw while it URI
 * encodes the qualifier, so a slug containing a colon shifts the segment
 * boundaries: slug `a:b` makes the path-less prefix `file:release:a:b:rel_1`
 * read as slug `a`, release `b`, path `rel_1` and pass. That is a false
 * positive on a PREFIX, and prefixes only ever reach `deleteByPrefix`, never
 * `getAsync`, so nothing is served from it. Encoding the slug would change the
 * shape of every live file cache key and every invalidation prefix, which is a
 * far larger change than the imprecision warrants; it is recorded here instead.
 */
export function isImmutableReleaseFileCacheKey(key: string): boolean {
  if (!key.startsWith(IMMUTABLE_KEY_PREFIX)) return false;
  if (key.includes(SCOPE_SEPARATOR)) return false;

  const segments = key.split(":");
  if (segments.length <= IMMUTABLE_KEY_PREFIX_SEGMENTS) return false;

  // projectSlug and releaseId must both be present, and a path has to follow.
  for (let index = 2; index < IMMUTABLE_KEY_PREFIX_SEGMENTS; index++) {
    if (segments[index] === "") return false;
  }
  return segments.slice(IMMUTABLE_KEY_PREFIX_SEGMENTS).join(":") !== "";
}

/**
 * The authority an entry may be held under, or `null` when the store must not
 * be used for this read.
 *
 * A project reference is always required, so an entry can never be handed to
 * another project. For the API backend a token is required as well, mirroring
 * `ApiCacheBackend`'s gate: a read the backend would refuse for want of a
 * credential must not be answered from process memory instead. The credential
 * identity is folded into the scope so two credentials never share an entry.
 */
export function buildImmutableL1Scope(
  backendType: string,
  authority: ResolvedCacheAuthority,
): string | null {
  const { token, projectRef } = authority;
  if (!projectRef || projectRef.includes(SCOPE_SEPARATOR)) return null;

  if (backendType !== "api") {
    // Redis and disk backends authorize by process-held credentials rather than
    // per request, so the project reference is the whole tenancy boundary.
    return `${backendType}${SCOPE_SEPARATOR}${projectRef}`;
  }

  if (!token) return null;
  return `api${SCOPE_SEPARATOR}${cacheCredentialIdentity(token)}${SCOPE_SEPARATOR}${projectRef}`;
}

/**
 * `buildImmutableL1Scope` for the authority the current request resolves to.
 *
 * `authority` must be the backend's OWN resolution when it has one, because a
 * backend constructed with an explicit endpoint credential reads under that
 * credential rather than under the ambient one. Re-deriving it here without
 * that credential would scope entries on a token the read never used, which is
 * exactly the drift `cache/request-authority.ts` exists to prevent.
 */
export function resolveImmutableL1Scope(
  backendType: string,
  authority: ResolvedCacheAuthority = resolveCacheRequestAuthority(),
): string | null {
  return buildImmutableL1Scope(backendType, authority);
}

interface ImmutableL1Entry {
  cacheKey: string;
  value: string;
  valueBytes: number;
  readStartedAtMs: number;
  expiresAtMs: number;
}

/**
 * Taken before a backend read starts and handed back to `admit`. Any
 * invalidation touching that key in between makes the fetched value
 * unadmissible, so a read already in flight cannot reinstate what was just
 * invalidated.
 *
 * `startedAtMs` records when the backend read began. The TTL is a bound on how
 * stale a served value can be relative to a revocation or a publish, and both
 * can land while the read is still in flight, so the entry's lifetime is
 * measured from this moment rather than from when the response arrived. A read
 * slow enough to consume the whole TTL admits nothing.
 */
export interface ImmutableL1ReadToken {
  readonly key: number;
  readonly sweep: number;
  readonly startedAtMs: number;
}

export interface ImmutableFileCacheL1 {
  readonly size: number;
  /** Entry-count ceiling in force, so profiler stats can report the bound. */
  readonly maxEntries: number;
  /** Bytes currently charged against the total-bytes ceiling. */
  readonly retainedBytes: number;
  beginRead(cacheKey: string): ImmutableL1ReadToken;
  /**
   * `maxAgeMs` is the CALLER's entry lifetime. The store is process-global
   * while lifetimes are configured per `FileCache` instance, so an entry is
   * served only while it is younger than both the lifetime it was admitted
   * with and the lifetime of the instance reading it, each measured from the
   * backend read start the entry's token recorded. A non-finite `maxAgeMs`
   * is ignored and the admission-time expiry alone governs.
   */
  lookup(scope: string, cacheKey: string, maxAgeMs?: number): string | null;
  /**
   * A `ttlMs` at or below zero, or not finite, admits nothing. Expiry is
   * anchored to the token's read start, so a read that was in flight long
   * enough to consume the whole TTL admits nothing either.
   */
  admit(
    scope: string,
    cacheKey: string,
    value: string,
    token: ImmutableL1ReadToken,
    ttlMs: number,
  ): void;
  dropKey(cacheKey: string): void;
  dropPrefix(prefix: string): void;
  /** Reclaims every expired entry now rather than when it is next touched. */
  evictExpired(): number;
  clear(): void;
}

/**
 * Parse a non-negative integer override, falling back on anything unusable.
 *
 * `maxValue`, when given, is a ceiling the configured value is CLAMPED to
 * rather than rejected for exceeding: an operator who asked for a longer
 * lifetime still gets the longest one that is allowed, instead of silently
 * getting the default they were trying to move away from. The clamp is logged
 * at warn level because a value being quietly reinterpreted is exactly the
 * failure a misconfiguration needs to be visible for.
 */
function readPositiveIntegerEnv(
  name: string,
  fallback: number,
  maxValue?: number,
): number {
  const raw = getEnvValue(name);
  if (raw === undefined || raw.trim() === "") return fallback;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;

  const value = Math.floor(parsed);
  if (maxValue !== undefined && value > maxValue) {
    logger.warn(
      "Configured cache limit exceeds its maximum and was clamped to the maximum",
      { setting: name, configured: value, clampedTo: maxValue },
    );
    return maxValue;
  }
  return value;
}

/**
 * Configured entry lifetime; `0` disables the tier.
 *
 * Clamped to `IMMUTABLE_L1_MAX_TTL_MS`, because this value is the width of the
 * credential-revocation window and of the cross-pod publish-visibility window,
 * not a staleness preference. See that constant for both.
 */
export function resolveImmutableL1TtlMs(): number {
  return readPositiveIntegerEnv(
    IMMUTABLE_L1_TTL_ENV_VAR,
    IMMUTABLE_L1_DEFAULT_TTL_MS,
    IMMUTABLE_L1_MAX_TTL_MS,
  );
}

/** Configured entry-count ceiling. */
export function resolveImmutableL1MaxEntries(): number {
  return readPositiveIntegerEnv(
    IMMUTABLE_L1_MAX_ENTRIES_ENV_VAR,
    IMMUTABLE_L1_DEFAULT_MAX_ENTRIES,
  );
}

/** Configured per-value ceiling in bytes. */
export function resolveImmutableL1MaxValueBytes(): number {
  return readPositiveIntegerEnv(
    IMMUTABLE_L1_MAX_VALUE_BYTES_ENV_VAR,
    IMMUTABLE_L1_DEFAULT_MAX_VALUE_BYTES,
  );
}

/** Configured total-bytes ceiling across every scope. */
export function resolveImmutableL1MaxTotalBytes(): number {
  return readPositiveIntegerEnv(
    IMMUTABLE_L1_MAX_TOTAL_BYTES_ENV_VAR,
    IMMUTABLE_L1_DEFAULT_MAX_TOTAL_BYTES,
  );
}

export interface ImmutableFileCacheL1Options {
  maxEntries?: number;
  maxValueBytes?: number;
  maxTotalBytes?: number;
}

/**
 * A programmatic ceiling is honored only when it is a finite, non-negative
 * number; anything else falls back to the configured default, exactly as an
 * unparseable env override does. NaN and Infinity compare their way past
 * every bound check below, so honoring one would silently disable eviction
 * rather than raise a limit.
 */
function sanitizeCeiling(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value < 0) return fallback;
  return Math.floor(value);
}

/**
 * Create the store. One instance is shared by every `FileCache` in the process;
 * entries are separated by scope rather than by instance.
 */
export function createImmutableFileCacheL1(
  options: ImmutableFileCacheL1Options = {},
): ImmutableFileCacheL1 {
  const maxEntries = sanitizeCeiling(options.maxEntries, resolveImmutableL1MaxEntries());
  const maxTotalBytes = sanitizeCeiling(options.maxTotalBytes, resolveImmutableL1MaxTotalBytes());
  // A value bigger than the whole store could ever hold is refused up front
  // rather than admitted and then immediately evicted along with everything
  // else, so a misconfigured per-value ceiling cannot churn the store empty.
  const maxValueBytes = Math.min(
    sanitizeCeiling(options.maxValueBytes, resolveImmutableL1MaxValueBytes()),
    maxTotalBytes,
  );

  // Insertion order is the LRU order: a hit re-inserts, eviction takes the head.
  const entries = new Map<string, ImmutableL1Entry>();
  let retainedBytes = 0;
  // Per-key mutation counters, plus one counter for whole-store invalidations.
  // The per-key map is bounded the same way the entries are, and overflowing it
  // bumps the sweep counter so nothing already in flight can slip past.
  const keyGenerations = new Map<string, number>();
  let sweep = 0;

  const scopedKey = (scope: string, cacheKey: string): string =>
    `${scope}${SCOPE_SEPARATOR}${cacheKey}`;

  /** The single place an entry leaves the store, so the byte total cannot drift. */
  const removeEntry = (storeKey: string): void => {
    const entry = entries.get(storeKey);
    if (!entry) return;
    retainedBytes -= entry.valueBytes;
    entries.delete(storeKey);
  };

  /** Removes every entry past its expiry; returns how many were reclaimed. */
  const sweepExpired = (): number => {
    if (entries.size === 0) return 0;

    const now = Date.now();
    let reclaimed = 0;
    for (const [storeKey, entry] of entries) {
      if (now < entry.expiresAtMs) continue;
      removeEntry(storeKey);
      reclaimed += 1;
    }
    return reclaimed;
  };

  const bumpKeyGeneration = (cacheKey: string): void => {
    keyGenerations.set(cacheKey, (keyGenerations.get(cacheKey) ?? 0) + 1);
    if (keyGenerations.size <= maxEntries) return;

    keyGenerations.clear();
    sweep += 1;
  };

  return {
    get size(): number {
      return entries.size;
    },
    get maxEntries(): number {
      return maxEntries;
    },
    get retainedBytes(): number {
      return retainedBytes;
    },
    beginRead(cacheKey: string): ImmutableL1ReadToken {
      return { key: keyGenerations.get(cacheKey) ?? 0, sweep, startedAtMs: Date.now() };
    },
    lookup(scope: string, cacheKey: string, maxAgeMs?: number): string | null {
      const storeKey = scopedKey(scope, cacheKey);
      const entry = entries.get(storeKey);
      if (!entry) return null;

      const now = Date.now();
      if (now >= entry.expiresAtMs) {
        removeEntry(storeKey);
        return null;
      }

      // The store is process-global while entry lifetimes are configured per
      // FileCache instance, so a caller with a shorter lifetime than the
      // admitting instance must not be served past its own bound. The entry
      // itself stays: it is still valid under the policy it was admitted with,
      // and callers whose lifetime allows it may keep reading it. Age is
      // measured from the backend read start, like the expiry above.
      if (
        maxAgeMs !== undefined && Number.isFinite(maxAgeMs) &&
        now - entry.readStartedAtMs >= maxAgeMs
      ) {
        return null;
      }

      // Re-insert to move the entry to the LRU tail. The byte total is
      // unchanged, so this deliberately does not go through removeEntry.
      entries.delete(storeKey);
      entries.set(storeKey, entry);
      return entry.value;
    },
    admit(
      scope: string,
      cacheKey: string,
      value: string,
      token: ImmutableL1ReadToken,
      ttlMs: number,
    ): void {
      // A non-finite TTL is refused outright: Infinity would stamp an entry
      // that never expires, and NaN would defeat the expiry comparison the
      // same way, so both would bypass the revalidation bound the TTL exists
      // to enforce.
      if (!Number.isFinite(ttlMs) || ttlMs <= 0) return;
      if (maxEntries <= 0 || maxTotalBytes <= 0) return;
      if (token.sweep !== sweep) return;
      if (token.key !== (keyGenerations.get(cacheKey) ?? 0)) return;

      // Checked before insertion: an oversized value must never be held, not
      // even for the moment it would take the eviction loop to drop it.
      const valueBytes = value.length * BYTES_PER_VALUE_CHAR;
      if (valueBytes > maxValueBytes) return;

      // Expiry is anchored to when the backend read STARTED, not to when its
      // response arrived. The TTL is the documented bound on revocation lag
      // and cross-pod publish-visibility lag, and both clocks start ticking
      // while the read is still in flight: a read pending for the backend's
      // full timeout and then stamped with a fresh TTL would be servable for
      // timeout plus TTL after the revocation. A read that already consumed
      // the whole TTL admits nothing.
      const readStartedAtMs = token.startedAtMs;
      const expiresAtMs = readStartedAtMs + ttlMs;
      if (Date.now() >= expiresAtMs) return;

      // Expired entries are reclaimed on every admission, so dead weight is
      // never charged against the ceilings while a live entry gets evicted,
      // and an idle store still sheds what has expired the next time anything
      // is admitted.
      sweepExpired();

      const storeKey = scopedKey(scope, cacheKey);
      removeEntry(storeKey);
      entries.set(storeKey, {
        cacheKey,
        value,
        valueBytes,
        readStartedAtMs,
        expiresAtMs,
      });
      retainedBytes += valueBytes;

      while (entries.size > maxEntries || retainedBytes > maxTotalBytes) {
        const oldest = entries.keys().next().value as string | undefined;
        if (oldest === undefined) break;
        removeEntry(oldest);
      }
    },
    dropKey(cacheKey: string): void {
      bumpKeyGeneration(cacheKey);
      if (entries.size === 0) return;

      for (const [storeKey, entry] of entries) {
        if (entry.cacheKey === cacheKey) removeEntry(storeKey);
      }
    },
    evictExpired(): number {
      return sweepExpired();
    },
    dropPrefix(prefix: string): void {
      sweep += 1;
      if (entries.size === 0) return;

      for (const [storeKey, entry] of entries) {
        if (entry.cacheKey.startsWith(prefix)) removeEntry(storeKey);
      }
    },
    clear(): void {
      sweep += 1;
      keyGenerations.clear();
      entries.clear();
      retainedBytes = 0;
    },
  };
}
