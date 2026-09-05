/**
 * Cached JSX artifact lifecycle.
 *
 * Owns the on-disk life of the `jsx-*.mjs` artifacts the JSX transform writes:
 * normalizing a cached module so its relative `_dnt.*` imports still resolve
 * from the cache directory, keeping the artifacts an in-flight render needs,
 * and retiring the ones no render still uses. The transform module produces
 * artifacts; this module bounds what they cost on disk.
 *
 * @module transforms/mdx/esm-module-loader/jsx-cache
 */

import { basename, dirname, join } from "#veryfront/compat/path";
import { isAlreadyExistsError, isNotFoundError } from "#veryfront/platform/compat/fs.ts";
import { unrefTimer } from "#veryfront/platform/compat/process.ts";
import { rendererLogger as logger } from "#veryfront/utils";
import { isWithinDirectory } from "#veryfront/utils/path-utils.ts";
import { Semaphore } from "#veryfront/utils/semaphore.ts";
import { parseImports } from "../../esm/lexer.ts";
import {
  buildMdxJsxCacheFileNamePrefix,
  MDX_JSX_CACHE_FILE_NAME_PREFIX_LENGTH,
  MDX_JSX_CACHE_NAMESPACE_PREFIX,
  MDX_JSX_CACHE_ROOT_PREFIX,
} from "./cache-format.ts";
import { LOG_PREFIX_MDX_LOADER } from "./constants.ts";
import { getLocalFs } from "./cache/index.ts";
import { rewriteDntImports } from "./module-fetcher/index.ts";
import { MAX_MDX_MODULE_IMPORTS_PER_FILE } from "./module-fetcher/limits.ts";
import { getMdxEsmCacheDir } from "#veryfront/utils/cache-dir.ts";
import { computeHash } from "#veryfront/utils/hash-utils.ts";

/** Bound on the cached-module paths this process remembers as normalized. */
const MAX_NORMALIZED_MODULE_MEMO_ENTRIES = 4096;
const cryptoRandomUUID = crypto.randomUUID.bind(crypto);
const IntrinsicJSONParse = JSON.parse;
const IntrinsicJSONStringify = JSON.stringify;
const IntrinsicObjectCreate = Object.create;

function cacheFilesystemErrorCode(error: unknown): string {
  if (isNotFoundError(error)) return "NOT_FOUND";
  if (isAlreadyExistsError(error)) return "ALREADY_EXISTS";
  return "FILESYSTEM_ERROR";
}

/**
 * Cached JSX module paths already known to be free of relative _dnt imports.
 *
 * A cache file name is derived from the source path and its full contents, so a
 * remembered path can never later describe different source. Without this, every
 * cache hit re-read and re-scanned the whole cached module, which let repeated
 * public requests for the same page pay that cost again on each render.
 */
const normalizedModulePaths = new Set<string>();

function rememberNormalizedModule(transformedPath: string): void {
  // Delete-before-add keeps the set in recency order, so reaching capacity
  // evicts the path normalized longest ago instead of wiping the whole memo
  // and re-charging every hot page a read and a scan at once.
  normalizedModulePaths.delete(transformedPath);
  if (normalizedModulePaths.size >= MAX_NORMALIZED_MODULE_MEMO_ENTRIES) {
    const oldest = normalizedModulePaths.values().next().value;
    if (oldest !== undefined) normalizedModulePaths.delete(oldest);
  }
  normalizedModulePaths.add(transformedPath);
}

/**
 * Validate and patch a cached JSX module in-place.
 *
 * Returns true if the cached module is usable, false if it should be re-generated.
 */
export async function ensureCachedJsxModulePatched(
  transformedPath: string,
  sourceFilePath: string,
  assertLeaseOwned?: () => Promise<void>,
): Promise<boolean> {
  const fs = getLocalFs();

  if (normalizedModulePaths.has(transformedPath)) {
    // The memo skips the read and the dnt scan, not the existence check: a
    // prune or an invalidation can remove the artifact between the caller's
    // stat and this call, and reporting it usable would hand the rewritten
    // parent a `file://` import for a module that is no longer there.
    if (await fs.exists(transformedPath)) return true;
    normalizedModulePaths.delete(transformedPath);
    return false;
  }

  try {
    const cachedCode = await fs.readTextFile(transformedPath);
    const rewritten = await rewriteDntImports(cachedCode, sourceFilePath);

    if (rewritten === cachedCode) {
      rememberNormalizedModule(transformedPath);
      return true;
    }

    await assertLeaseOwned?.();
    await fs.writeTextFile(transformedPath, rewritten);
    logger.debug(`${LOG_PREFIX_MDX_LOADER} Rewrote cached JSX dnt imports`, {
      sourceFilePath,
      transformedPath,
    });

    rememberNormalizedModule(transformedPath);
    return true;
  } catch (error) {
    logger.debug(`${LOG_PREFIX_MDX_LOADER} Failed to read cached JSX module`, {
      sourceFilePath,
      transformedPath,
      error: cacheFilesystemErrorCode(error),
    });
    return false;
  }
}

/**
 * Cached content variants retained per source path.
 *
 * Deleting every variant but the one this pass wrote is not safe: a render
 * that transformed an older generation of the same path is still holding the
 * `file://` specifier of its own artifact, and deleting it breaks that render's
 * module load. The window is sized above the default per-project request
 * ceiling (`maxConcurrentPerProject`, 20) so ordinary concurrency never reaches
 * it; {@link JSX_CACHE_VARIANT_MIN_AGE_MS} and the active references a render
 * holds until its parent import settles are what actually guarantee an
 * in-flight artifact survives when that ceiling is raised.
 */
export const MAX_JSX_CACHE_VARIANTS_PER_PATH = 32;

/** Hard count ceiling for current-namespace JSX artifacts in one cache directory. */
export const MAX_JSX_CACHE_ARTIFACTS_PER_DIRECTORY = 4 * MAX_MDX_MODULE_IMPORTS_PER_FILE;

/**
 * Age an artifact must reach before it can be retired.
 *
 * A retention count alone assumes concurrency stays below the window. This
 * floor removes the assumption for the moments before a render pins its
 * artifacts: an artifact a transform just returned is by definition younger
 * than the grace period, so no prune pass can delete it in the gap between
 * `transformJsxImports` returning and the render acquiring its active
 * references via {@link retainJsxArtifactsReferencedIn}. Once those references
 * exist they, not this floor, are what carry the artifact through the rest of
 * the render, however long its module-recovery phase runs.
 */
export const JSX_CACHE_VARIANT_MIN_AGE_MS = 60_000;

/**
 * Age a variant inside the per-path window must reach, measured from its last
 * use, before it is retired as idle.
 *
 * The per-path window alone bounds only paths that keep receiving writes: a
 * tenant that renames its imported source on every edit leaves one variant per
 * retired path, each in a prefix group too small for the window to touch, so
 * per-project disk growth would again track edit history. Idle collection is
 * the directory-wide backstop: any artifact whose last use (mtime, refreshed
 * by cache hits) is older than this floor is deleted no matter how few
 * variants share its prefix, so the cache converges on the artifacts the
 * project actually served recently.
 */
export const JSX_CACHE_VARIANT_MAX_IDLE_AGE_MS = 6 * 60 * 60 * 1_000;

/**
 * How stale an artifact's mtime may grow before a cache hit refreshes it.
 *
 * A hit refreshes the file's mtime so "last use" is visible across processes
 * (the in-memory served memo and active references are not), which is what
 * lets one process's grace check protect an artifact another process (for
 * example one draining during a rolling deploy) just served. The interval
 * keeps the refresh to at most one metadata write per artifact per interval.
 */
const JSX_CACHE_MTIME_REFRESH_INTERVAL_MS = JSX_CACHE_VARIANT_MIN_AGE_MS / 4;

/**
 * Per-project request ceiling this cache's memos are sized against
 * (`maxConcurrentPerProject` in `server/runtime-handler/project-isolation.ts`;
 * kept as a local mirror so the transform layer does not import server
 * runtime configuration).
 */
const SUPPORTED_CONCURRENT_RENDERS_PER_PROJECT = 20;

/**
 * Bound on the artifacts this process remembers as recently served.
 *
 * Sized to twice the supported in-flight fan-out (the per-project request
 * ceiling times the per-module import ceiling) so reaching capacity can only
 * ever evict marks that no supported load pattern still relies on. Active
 * references, not this memo, are what protect a render across its long
 * post-transform phases; the memo only has to cover the moments between a
 * transform returning and those references being acquired.
 */
const MAX_SERVED_ARTIFACT_MEMO_ENTRIES = 2 * SUPPORTED_CONCURRENT_RENDERS_PER_PROJECT *
  MAX_MDX_MODULE_IMPORTS_PER_FILE;

/**
 * When this process last handed each artifact path to a render.
 *
 * An artifact's mtime records when it was written, not when it was last used,
 * so a cache hit on an artifact older than the grace period would otherwise be
 * eligible for deletion between the moment a render selects its `file://` URL
 * and the moment `doLoadModuleESM` imports the rewritten parent. Recording the
 * hit keeps the artifact out of pruning for one further grace period.
 */
const servedArtifactTimestamps = new Map<string, number>();

export function markJsxArtifactServed(
  transformedPath: string,
  servedAtMs: number = Date.now(),
): void {
  // Delete-before-set keeps the map in recency order, so reaching capacity
  // evicts the artifact served longest ago instead of wiping the whole memo
  // and momentarily dropping the protection every in-flight hit relies on.
  servedArtifactTimestamps.delete(transformedPath);
  if (servedArtifactTimestamps.size >= MAX_SERVED_ARTIFACT_MEMO_ENTRIES) {
    const oldest = servedArtifactTimestamps.keys().next().value;
    if (oldest !== undefined) servedArtifactTimestamps.delete(oldest);
  }
  servedArtifactTimestamps.set(transformedPath, servedAtMs);
}

function wasJsxArtifactRecentlyServed(transformedPath: string, nowMs: number): boolean {
  const servedAtMs = servedArtifactTimestamps.get(transformedPath);
  return servedAtMs !== undefined && nowMs - servedAtMs < JSX_CACHE_VARIANT_MIN_AGE_MS;
}

/**
 * Artifacts currently pinned by an in-flight render, by reference count.
 *
 * A render acquires a reference to every artifact its rewritten module imports
 * (via {@link retainJsxArtifactsReferencedIn}) and releases it after the parent
 * dynamic import settles. Unlike the served memo, which is a fixed-age lease,
 * a reference is unconditional: no prune pass removes a referenced artifact,
 * however long the render's HTTP-caching and bundle-recovery phases run.
 */
const jsxArtifactActiveRefs = new Map<string, number>();
const LAZY_JSX_ARTIFACT_RETENTION_MS = 10 * 60_000;
const LAZY_JSX_ARTIFACT_HEARTBEAT_CONCURRENCY = 8;
const JSX_ARTIFACT_REFRESH_CONCURRENCY = 8;
const SCHEDULED_JSX_CACHE_PRUNE_CONCURRENCY = 8;
const MAX_LAZY_JSX_ARTIFACTS = MAX_SERVED_ARTIFACT_MEMO_ENTRIES;
const lazyJsxArtifactExpirations = new Map<string, { expiresAtMs: number; reservations: number }>();
let lazyJsxArtifactHeartbeat: ReturnType<typeof setInterval> | undefined;
let lazyJsxArtifactHeartbeatInFlight: Promise<void> | undefined;
const jsxArtifactMetadataSemaphore = new Semaphore(JSX_ARTIFACT_REFRESH_CONCURRENCY, {
  name: "jsx-artifact-metadata",
});
const scheduledJsxCachePruneSemaphore = new Semaphore(SCHEDULED_JSX_CACHE_PRUNE_CONCURRENCY, {
  name: "scheduled-jsx-cache-prune",
});

function withJsxArtifactRefreshSlot<T>(operation: () => Promise<T>): Promise<T> {
  return jsxArtifactMetadataSemaphore.acquire(operation);
}

/** Refresh artifact mtimes through the process-wide bounded filesystem pool. */
export function refreshJsxArtifactsBounded(
  artifactPaths: readonly string[],
  required = false,
): Promise<void> {
  let nextIndex = 0;
  const workerCount = Math.min(JSX_ARTIFACT_REFRESH_CONCURRENCY, artifactPaths.length);
  const workers: Array<Promise<void>> = [];
  for (let workerIndex = 0; workerIndex < workerCount; workerIndex++) {
    workers[workers.length] = (async () => {
      while (nextIndex < artifactPaths.length) {
        const artifactPath = artifactPaths[nextIndex++];
        if (artifactPath === undefined) continue;
        await withJsxArtifactLock(artifactPath, async (assertLeaseOwned) => {
          await withJsxArtifactRefreshSlot(async () => {
            await assertLeaseOwned();
            await refreshJsxArtifactMtime(artifactPath, 0, Date.now(), required);
          });
        });
      }
    })();
  }
  return Promise.all(workers).then(() => undefined);
}

function retainJsxArtifact(artifactPath: string): void {
  jsxArtifactActiveRefs.set(artifactPath, (jsxArtifactActiveRefs.get(artifactPath) ?? 0) + 1);
}

function releaseJsxArtifact(artifactPath: string): void {
  const count = jsxArtifactActiveRefs.get(artifactPath);
  if (count === undefined) return;
  if (count <= 1) jsxArtifactActiveRefs.delete(artifactPath);
  else jsxArtifactActiveRefs.set(artifactPath, count - 1);
}

function runLazyJsxArtifactHeartbeat(): Promise<void> {
  if (lazyJsxArtifactHeartbeatInFlight) return lazyJsxArtifactHeartbeatInFlight;
  const run = (async () => {
    const nowMs = Date.now();
    const artifactPaths: string[] = [];
    for (const [artifactPath, retention] of lazyJsxArtifactExpirations) {
      if (retention.reservations === 0 && retention.expiresAtMs <= nowMs) {
        lazyJsxArtifactExpirations.delete(artifactPath);
        continue;
      }
      artifactPaths[artifactPaths.length] = artifactPath;
    }
    let nextIndex = 0;
    const workers: Array<Promise<void>> = [];
    const workerCount = Math.min(
      LAZY_JSX_ARTIFACT_HEARTBEAT_CONCURRENCY,
      artifactPaths.length,
    );
    for (let workerIndex = 0; workerIndex < workerCount; workerIndex++) {
      workers[workers.length] = (async () => {
        while (nextIndex < artifactPaths.length) {
          const artifactPath = artifactPaths[nextIndex++];
          if (artifactPath === undefined) continue;
          await withJsxArtifactLock(artifactPath, async (assertLeaseOwned) => {
            await withJsxArtifactRefreshSlot(async () => {
              await assertLeaseOwned();
              await refreshJsxArtifactMtime(artifactPath, 0);
            });
          }).catch(() => undefined);
        }
      })();
    }
    await Promise.all(workers);
  })();
  lazyJsxArtifactHeartbeatInFlight = run.finally(() => {
    lazyJsxArtifactHeartbeatInFlight = undefined;
    if (lazyJsxArtifactExpirations.size === 0 && lazyJsxArtifactHeartbeat !== undefined) {
      clearInterval(lazyJsxArtifactHeartbeat);
      lazyJsxArtifactHeartbeat = undefined;
    }
  });
  return lazyJsxArtifactHeartbeatInFlight;
}

function ensureLazyJsxArtifactHeartbeat(): void {
  if (lazyJsxArtifactHeartbeat !== undefined) return;
  lazyJsxArtifactHeartbeat = setInterval(() => {
    void runLazyJsxArtifactHeartbeat();
  }, JSX_CACHE_MTIME_REFRESH_INTERVAL_MS);
  unrefTimer(lazyJsxArtifactHeartbeat);
}

function reserveLazyJsxArtifacts(paths: readonly string[]): (retain: boolean) => void {
  const unique = [...new Set(paths)];
  const additionalCount = () =>
    unique.filter((path) => !lazyJsxArtifactExpirations.has(path)).length;
  if (lazyJsxArtifactExpirations.size + additionalCount() > MAX_LAZY_JSX_ARTIFACTS) {
    const now = Date.now();
    for (const [path, record] of lazyJsxArtifactExpirations) {
      if (record.reservations === 0 && record.expiresAtMs <= now) {
        lazyJsxArtifactExpirations.delete(path);
      }
    }
  }
  if (lazyJsxArtifactExpirations.size + additionalCount() > MAX_LAZY_JSX_ARTIFACTS) {
    throw new JsxCacheCapacityError("JSX lazy artifact retention capacity is exhausted");
  }
  const reservations = unique.map((path) => {
    const record = lazyJsxArtifactExpirations.get(path) ?? { expiresAtMs: 0, reservations: 0 };
    record.reservations++;
    lazyJsxArtifactExpirations.set(path, record);
    return { path, record };
  });
  if (reservations.length > 0) ensureLazyJsxArtifactHeartbeat();
  let released = false;
  return (retain) => {
    if (released) return;
    released = true;
    const now = Date.now();
    for (const { path, record } of reservations) {
      if (lazyJsxArtifactExpirations.get(path) !== record) continue;
      record.reservations--;
      if (retain) {
        record.expiresAtMs = Math.max(record.expiresAtMs, now + LAZY_JSX_ARTIFACT_RETENTION_MS);
      }
      if (record.reservations === 0 && record.expiresAtMs <= now) {
        lazyJsxArtifactExpirations.delete(path);
      }
    }
  };
}

function retainLazyJsxArtifact(artifactPath: string): void {
  reserveLazyJsxArtifacts([artifactPath])(true);
}

function isLazyJsxArtifactRetained(artifactPath: string, nowMs: number = Date.now()): boolean {
  const retention = lazyJsxArtifactExpirations.get(artifactPath);
  if (retention === undefined) return false;
  if (retention.reservations > 0 || retention.expiresAtMs > nowMs) return true;
  lazyJsxArtifactExpirations.delete(artifactPath);
  return false;
}

/**
 * When this process last wrote each artifact's mtime forward.
 *
 * `retainJsxArtifactsReferencedIn` holds no fresh stat to compare against, so
 * without this memo every render of a module with cached JSX imports would pay
 * one `utime` per import up front and again on each heartbeat, turning hot
 * cache hits into metadata-write and lock contention. Remembering the last
 * refresh keeps the write-through to at most one per artifact per interval,
 * whatever mtime the caller happens to know. Bounded and evicted in recency
 * order like the served memo; an evicted entry only costs one extra `utime`.
 */
const mtimeRefreshTimestamps = new Map<string, number>();

function recordJsxArtifactMtimeRefresh(artifactPath: string, refreshedAtMs: number): void {
  mtimeRefreshTimestamps.delete(artifactPath);
  if (mtimeRefreshTimestamps.size >= MAX_SERVED_ARTIFACT_MEMO_ENTRIES) {
    const oldest = mtimeRefreshTimestamps.keys().next().value;
    if (oldest !== undefined) mtimeRefreshTimestamps.delete(oldest);
  }
  mtimeRefreshTimestamps.set(artifactPath, refreshedAtMs);
}

/**
 * Refresh an artifact's mtime so its last use is visible to other processes.
 *
 * Best effort on a best-effort signal: a runtime without `utime` (or a failed
 * refresh) falls back to the in-process served memo, which still protects
 * every render this process owns.
 */
export async function refreshJsxArtifactMtime(
  artifactPath: string,
  modifiedAtMs: number,
  nowMs: number = Date.now(),
  required = false,
): Promise<void> {
  const lastRefreshedMs = Math.max(
    modifiedAtMs,
    mtimeRefreshTimestamps.get(artifactPath) ?? 0,
  );
  if (nowMs - lastRefreshedMs < JSX_CACHE_MTIME_REFRESH_INTERVAL_MS) return;
  const localFs = getLocalFs();
  if (!localFs.utime) {
    if (required) throw new Error("Shared JSX artifact recency refresh is unavailable");
    return;
  }
  try {
    await localFs.utime(artifactPath, new Date(nowMs), new Date(nowMs));
    recordJsxArtifactMtimeRefresh(artifactPath, nowMs);
  } catch (error) {
    if (required) {
      throw new Error(
        `Shared JSX artifact recency refresh failed (${cacheFilesystemErrorCode(error)})`,
      );
    }
    /* expected: a concurrent prune may have removed the artifact already */
  }
}

/**
 * Whether `specifier` names an artifact this cache owns inside `esmCacheDir`.
 *
 * Name shape alone is not enough. `transformJsxImports` rewrites only the
 * `file://` specifiers that end in a JSX/TS extension, so a tenant-authored
 * `import "file:///elsewhere/jsx-x.mjs"` reaches the rewritten module intact:
 * without containment it would be pinned as a cache artifact and receive a
 * real `utime` write on a path this cache does not own, and it could fill the
 * served memo with fabricated entries that evict genuine marks.
 */
function resolveOwnedJsxArtifactPath(
  specifier: string | undefined,
  esmCacheDir: string,
): string | undefined {
  if (!specifier?.startsWith("file://")) return undefined;
  const artifactPath = specifier.slice("file://".length);
  const name = artifactPath.split("/").at(-1) ?? "";
  if (!name.startsWith(MDX_JSX_CACHE_ROOT_PREFIX) || !name.endsWith(".mjs")) return undefined;
  if (!isWithinDirectory(esmCacheDir, artifactPath)) return undefined;
  return artifactPath;
}

/**
 * Pin every JSX cache artifact the rewritten module imports until the caller
 * releases them, keeping each one's on-disk recency fresh in the meantime.
 *
 * `doLoadModuleESM` performs HTTP caching and bundle recovery between the JSX
 * transform returning its `file://` specifiers and the dynamic import that
 * consumes them, and that phase has no time bound. The references keep every
 * prune pass in this process away from the artifacts for that whole span, and
 * the periodic mtime refresh keeps other processes' grace checks away from
 * them too. The returned release is idempotent and must be called once the
 * parent import has settled, success or failure.
 */
export async function retainJsxArtifactsReferencedIn(
  code: string,
  esmCacheDir: string,
): Promise<() => void> {
  const artifactPaths: string[] = [];
  const lazyArtifactPaths: string[] = [];
  for (const imported of await parseImports(code)) {
    const artifactPath = resolveOwnedJsxArtifactPath(imported.n, esmCacheDir);
    if (artifactPath === undefined) continue;
    artifactPaths.push(artifactPath);
    if (imported.d > -1) lazyArtifactPaths.push(artifactPath);
    // Both static and lazy artifacts stay actively pinned until the parent
    // import settles. Lazy retention starts only at release, when the parent
    // module cache lifetime begins.
  }
  if (artifactPaths.length === 0) return () => {};
  const releaseLazyReservation = reserveLazyJsxArtifacts(lazyArtifactPaths);
  for (const artifactPath of artifactPaths) retainJsxArtifact(artifactPath);

  // A module may import the same artifact under several specifiers; one
  // refresh per artifact is what "last use" needs, so the duplicates stay
  // only in the reference counts, which release symmetrically below.
  const uniqueArtifactPaths = [...new Set(artifactPaths)];
  let refreshInFlight: Promise<void> | undefined;
  const refreshAll = (): Promise<void> => {
    if (refreshInFlight) return refreshInFlight;
    const run = refreshJsxArtifactsBounded(uniqueArtifactPaths, true);
    refreshInFlight = run.finally(() => {
      refreshInFlight = undefined;
    });
    return refreshInFlight;
  };
  try {
    await refreshAll();
  } catch (error) {
    for (const artifactPath of artifactPaths) releaseJsxArtifact(artifactPath);
    releaseLazyReservation(false);
    throw error;
  }
  const heartbeat = setInterval(
    () => void refreshAll().catch(() => undefined),
    JSX_CACHE_MTIME_REFRESH_INTERVAL_MS,
  );
  unrefTimer(heartbeat);

  let released = false;
  return () => {
    if (released) return;
    released = true;
    clearInterval(heartbeat);
    const nowMs = Date.now();
    for (const artifactPath of artifactPaths) {
      // The import just completed, so the module is as recently used as a
      // fresh cache hit: the served mark bridges the release and any
      // immediately following prune pass.
      markJsxArtifactServed(artifactPath, nowMs);
    }
    for (const artifactPath of artifactPaths) releaseJsxArtifact(artifactPath);
    releaseLazyReservation(true);
  };
}

/**
 * Per-artifact operation queues, dropped once the last queued operation
 * settles, so the map holds only paths with an operation in flight.
 */
const jsxArtifactLocks = new Map<string, Promise<void>>();
const JSX_ARTIFACT_LEASE_RETRY_MS = 10;
const JSX_ARTIFACT_LEASE_ATTEMPTS = 500;
const JSX_ARTIFACT_LEASE_STALE_MS = 60_000;
const JSX_ARTIFACT_LEASE_HEARTBEAT_MS = JSX_ARTIFACT_LEASE_STALE_MS / 3;
const JSX_ARTIFACT_LEASE_TRANSITION_SUFFIX = ".transition";
const leaseEncoder = new TextEncoder();

/** Base name of the directory-wide lock the artifact quota serializes on. */
const JSX_DIRECTORY_QUOTA_LOCK_BASE_NAME = ".jsx-directory-quota";

/** Tail a stale-lease recovery gives the lock file it renames aside. */
const JSX_LEASE_TOMBSTONE_PATTERN =
  /\.lock(?:\.transition)?\.(?:stale|release)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Recognize a `.stale-<uuid>` tombstone this loader's lease recovery left.
 *
 * Recovery removes its own tombstone, but that removal is best effort: a
 * transient filesystem error, or a process that exits between the rename and
 * the removal, leaves the file behind. Nothing ever opens a tombstone after
 * the recovery that produced it, and the prune pass otherwise looks only at
 * `jsx-*.mjs` artifacts, so an unswept tombstone would sit in the cache
 * directory forever and repeated recoveries under a persistent filesystem
 * condition could grow a bounded directory without limit.
 */
function isJsxLeaseTombstoneName(name: string): boolean {
  if (
    !name.startsWith(MDX_JSX_CACHE_ROOT_PREFIX) &&
    !name.startsWith(JSX_DIRECTORY_QUOTA_LOCK_BASE_NAME) &&
    !name.startsWith(JSX_CACHE_PRUNE_REQUEST_PREFIX)
  ) {
    return false;
  }
  return JSX_LEASE_TOMBSTONE_PATTERN.test(name);
}

function isJsxLeaseTransitionName(name: string): boolean {
  if (
    !name.startsWith(MDX_JSX_CACHE_ROOT_PREFIX) &&
    !name.startsWith(JSX_DIRECTORY_QUOTA_LOCK_BASE_NAME) &&
    !name.startsWith(JSX_CACHE_PRUNE_REQUEST_PREFIX)
  ) {
    return false;
  }
  return name.endsWith(`.lock${JSX_ARTIFACT_LEASE_TRANSITION_SUFFIX}`);
}

async function sweepJsxLeaseTombstones(
  directory: string,
  names: readonly string[],
  nowMs: number,
): Promise<number | undefined> {
  let retryAtMs: number | undefined;
  const noteRetry = (readyAtMs: number) => {
    retryAtMs = retryAtMs === undefined ? readyAtMs : Math.min(retryAtMs, readyAtMs);
  };

  // A recovery rename can capture a fresh replacement owner after validating
  // a stale predecessor. Both recovery and release tombstones therefore stay
  // protected for one full lease-stale interval before maintenance removes an
  // abandoned file.
  for (const name of names) {
    const path = join(directory, name);
    const modifiedAtMs = await readArtifactModifiedAtMs(path);
    const collectableAtMs = modifiedAtMs + JSX_ARTIFACT_LEASE_STALE_MS;
    if (modifiedAtMs > 0 && collectableAtMs > nowMs) {
      noteRetry(collectableAtMs);
      continue;
    }
    try {
      await getLocalFs().remove(path);
    } catch (error) {
      if (isNotFoundError(error)) continue;
      // Transient removal failures are exactly the case this sweep exists for,
      // so come back rather than waiting for unrelated cache work.
      noteRetry(nowMs + JSX_CACHE_VARIANT_MIN_AGE_MS);
    }
  }

  return retryAtMs;
}

function leaseTransitionPath(lockPath: string): string {
  return `${lockPath}${JSX_ARTIFACT_LEASE_TRANSITION_SUFFIX}`;
}

async function hasLiveFilesystemLeaseTransition(
  lockPath: string,
  nowMs = Date.now(),
): Promise<boolean> {
  const path = leaseTransitionPath(lockPath);
  let observedOwner: string;
  let modifiedAtMs: number;
  try {
    modifiedAtMs = (await getLocalFs().stat(path)).mtime?.getTime() ?? nowMs;
    observedOwner = await getLocalFs().readTextFile(path);
    const confirmedModifiedAtMs = (await getLocalFs().stat(path)).mtime?.getTime() ?? nowMs;
    if (confirmedModifiedAtMs !== modifiedAtMs) return true;
  } catch (error) {
    if (isNotFoundError(error)) return false;
    throw error;
  }
  if (nowMs - modifiedAtMs < JSX_ARTIFACT_LEASE_STALE_MS) return true;

  // Callers reach this only while they exclusively own `lockPath`. No other
  // process can create a replacement transition until that canonical lease is
  // released, so token-checked removal cannot unlink a successor.
  await removeFilesystemLeaseIfOwned(path, observedOwner);
  return false;
}

async function sweepJsxLeaseTransitions(
  directory: string,
  names: readonly string[],
  nowMs: number,
): Promise<number | undefined> {
  const localFs = getLocalFs();
  if (!localFs.createFileBytesExclusive || !localFs.rename) {
    return names.length === 0 ? undefined : nowMs + JSX_CACHE_VARIANT_MIN_AGE_MS;
  }

  let retryAtMs: number | undefined;
  const noteRetry = (readyAtMs: number) => {
    retryAtMs = retryAtMs === undefined ? readyAtMs : Math.min(retryAtMs, readyAtMs);
  };
  for (const name of names) {
    const transitionPath = join(directory, name);
    const lockPath = transitionPath.slice(0, -JSX_ARTIFACT_LEASE_TRANSITION_SUFFIX.length);
    try {
      const modifiedAtMs = await readArtifactModifiedAtMs(transitionPath);
      if (modifiedAtMs > 0 && nowMs - modifiedAtMs >= JSX_ARTIFACT_LEASE_STALE_MS) {
        await withJsxArtifactLock(lockPath.slice(0, -".lock".length), async () => undefined);
        continue;
      }
      noteRetry(
        modifiedAtMs === 0 ? nowMs + JSX_CACHE_VARIANT_MIN_AGE_MS : Math.max(
          nowMs + JSX_CACHE_PRUNE_RETRY_SLACK_MS,
          modifiedAtMs + JSX_ARTIFACT_LEASE_STALE_MS,
        ),
      );
    } catch {
      noteRetry(nowMs + JSX_CACHE_VARIANT_MIN_AGE_MS);
    }
  }
  return retryAtMs;
}

async function acquireFilesystemLeaseTransition(
  lockPath: string,
  createExclusive: (path: string, data: Uint8Array) => Promise<void>,
): Promise<string> {
  const path = leaseTransitionPath(lockPath);
  const owner = cryptoRandomUUID();
  const bytes = leaseEncoder.encode(owner);
  for (let attempt = 0; attempt < JSX_ARTIFACT_LEASE_ATTEMPTS; attempt++) {
    try {
      await createExclusive(path, bytes);
      return owner;
    } catch (error) {
      if (!isAlreadyExistsError(error)) throw error;
      if (!(await hasLiveFilesystemLeaseTransition(lockPath))) continue;
      await new Promise((resolve) => setTimeout(resolve, JSX_ARTIFACT_LEASE_RETRY_MS));
    }
  }
  throw new Error(`Timed out waiting for JSX cache lease transition ${basename(lockPath)}`);
}

async function recoverStaleFilesystemLease(
  lockPath: string,
  nowMs: number,
  createExclusive: (path: string, data: Uint8Array) => Promise<void>,
): Promise<boolean> {
  const localFs = getLocalFs();
  if (!localFs.rename) return false;
  let modifiedAtMs: number;
  let observedOwner: string;
  try {
    modifiedAtMs = (await localFs.stat(lockPath)).mtime?.getTime() ?? nowMs;
    await localFs.readTextFile(lockPath);
    const confirmedModifiedAtMs = (await localFs.stat(lockPath)).mtime?.getTime() ?? nowMs;
    if (confirmedModifiedAtMs !== modifiedAtMs) return false;
  } catch (error) {
    return isNotFoundError(error);
  }
  if (nowMs - modifiedAtMs < JSX_ARTIFACT_LEASE_STALE_MS) return false;

  let transitionOwner: string | undefined;
  const transitionPath = leaseTransitionPath(lockPath);
  try {
    transitionOwner = cryptoRandomUUID();
    await createExclusive(transitionPath, leaseEncoder.encode(transitionOwner));
  } catch (error) {
    if (!isAlreadyExistsError(error)) throw error;
    transitionOwner = undefined;
    const transitionModifiedAtMs = await readArtifactModifiedAtMs(transitionPath);
    if (
      transitionModifiedAtMs === 0 ||
      nowMs - transitionModifiedAtMs < JSX_ARTIFACT_LEASE_STALE_MS
    ) return false;
  }
  const stalePath = `${lockPath}.stale-${cryptoRandomUUID()}`;
  try {
    try {
      modifiedAtMs = (await localFs.stat(lockPath)).mtime?.getTime() ?? nowMs;
      observedOwner = await localFs.readTextFile(lockPath);
      if (nowMs - modifiedAtMs < JSX_ARTIFACT_LEASE_STALE_MS) return false;
      await localFs.rename(lockPath, stalePath);
    } catch (error) {
      if (isNotFoundError(error)) return true;
      return false;
    }
    let renamedOwner: string;
    try {
      renamedOwner = await localFs.readTextFile(stalePath);
    } catch {
      return false;
    }
    if (renamedOwner !== observedOwner) {
      // A fresh owner replaced the stale file between validation and rename.
      // Restore that unique owner token with an exclusive create when the path
      // is still empty. The fresh operation's ownership fence then either keeps
      // working or observes the newer waiter that won this restoration race.
      await restoreDisplacedFilesystemLease(lockPath, stalePath, renamedOwner, createExclusive);
      try {
        await localFs.remove(stalePath);
      } catch (_) {
        // Same stranding risk as the removal below, so arm the same sweep.
        scheduleJsxCachePruneRetry(dirname(lockPath), JSX_CACHE_PRUNE_RETRY_SLACK_MS);
      }
      return false;
    }
    try {
      await localFs.remove(stalePath);
    } catch (_) {
      // The uniquely renamed lease no longer blocks this lock. Schedule the
      // normal directory sweep so a transient EBUSY/permission race cannot
      // strand one tombstone per recovery forever.
      scheduleJsxCachePruneRetry(dirname(lockPath), JSX_CACHE_PRUNE_RETRY_SLACK_MS);
    }
    return true;
  } finally {
    if (transitionOwner !== undefined) {
      await removeFilesystemLeaseTransitionIfOwned(lockPath, transitionOwner);
    }
  }
}

async function removeFilesystemLeaseIfOwned(lockPath: string, owner: string): Promise<void> {
  try {
    if (await getLocalFs().readTextFile(lockPath) !== owner) return;
    await getLocalFs().remove(lockPath);
  } catch (error) {
    if (!isNotFoundError(error)) throw error;
  }
}

async function removeFilesystemLeaseTransitionIfOwned(
  lockPath: string,
  owner: string,
): Promise<void> {
  try {
    await removeFilesystemLeaseIfOwned(leaseTransitionPath(lockPath), owner);
  } catch (error) {
    logger.debug(`${LOG_PREFIX_MDX_LOADER} Failed to release JSX cache lease transition`, {
      error: cacheFilesystemErrorCode(error),
    });
    scheduleJsxCachePruneRetry(dirname(lockPath), JSX_CACHE_PRUNE_RETRY_SLACK_MS);
  }
}

async function restoreDisplacedFilesystemLease(
  lockPath: string,
  transitionPath: string,
  owner: string,
  createExclusive: (path: string, data: Uint8Array) => Promise<void>,
): Promise<void> {
  for (let attempt = 0; attempt < JSX_ARTIFACT_LEASE_ATTEMPTS; attempt++) {
    try {
      await createExclusive(lockPath, leaseEncoder.encode(owner));
      return;
    } catch (error) {
      if (!isAlreadyExistsError(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, JSX_ARTIFACT_LEASE_RETRY_MS));
    }
  }
  throw new Error(
    `Timed out restoring displaced JSX cache lease transition ${basename(transitionPath)}`,
  );
}

async function withFilesystemLease<T>(
  lockPath: string,
  operation: (assertLeaseOwned: () => Promise<void>) => Promise<T>,
  waitForLiveLease = false,
): Promise<T> {
  const localFs = getLocalFs();
  const createExclusive = localFs.createFileBytesExclusive;
  const rename = localFs.rename;
  if (!createExclusive || !rename) throw new Error("Atomic JSX cache leases are unavailable");

  const leaseOwner = cryptoRandomUUID();
  const leaseBytes = leaseEncoder.encode(leaseOwner);
  let acquired = false;
  for (
    let attempt = 0;
    waitForLiveLease || attempt < JSX_ARTIFACT_LEASE_ATTEMPTS;
    attempt++
  ) {
    try {
      await createExclusive(lockPath, leaseBytes);
      try {
        if (await hasLiveFilesystemLeaseTransition(lockPath)) {
          await removeFilesystemLeaseIfOwned(lockPath, leaseOwner);
          await new Promise((resolve) => setTimeout(resolve, JSX_ARTIFACT_LEASE_RETRY_MS));
          continue;
        }
      } catch (error) {
        await removeFilesystemLeaseIfOwned(lockPath, leaseOwner);
        throw error;
      }
      acquired = true;
      break;
    } catch (error) {
      if (!isAlreadyExistsError(error)) throw error;
      if (await recoverStaleFilesystemLease(lockPath, Date.now(), createExclusive)) continue;
      await new Promise((resolve) => setTimeout(resolve, JSX_ARTIFACT_LEASE_RETRY_MS));
    }
  }
  if (!acquired) throw new Error("Timed out waiting for a JSX cache lease");

  const heartbeat = localFs.utime
    ? setInterval(() => {
      const now = new Date();
      void localFs.utime?.(lockPath, now, now).catch(() => undefined);
    }, JSX_ARTIFACT_LEASE_HEARTBEAT_MS)
    : undefined;
  if (heartbeat !== undefined) unrefTimer(heartbeat);

  let transitionOwner: string | undefined;
  const assertLeaseOwned = async (): Promise<void> => {
    let transitionIsOwned = true;
    try {
      transitionIsOwned =
        await localFs.readTextFile(leaseTransitionPath(lockPath)) === transitionOwner;
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
    }
    try {
      if (transitionIsOwned && await localFs.readTextFile(lockPath) === leaseOwner) return;
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
    }
    throw new Error("JSX cache lease ownership changed during the operation");
  };

  try {
    await assertLeaseOwned();
    return await operation(assertLeaseOwned);
  } finally {
    if (heartbeat !== undefined) clearInterval(heartbeat);
    const releasePath = `${lockPath}.release-${cryptoRandomUUID()}`;
    try {
      await assertLeaseOwned();
      transitionOwner = await acquireFilesystemLeaseTransition(lockPath, createExclusive);
      await assertLeaseOwned();
      await localFs.rename!(lockPath, releasePath);
      const releasedOwner = await localFs.readTextFile(releasePath);
      if (releasedOwner !== leaseOwner) {
        await restoreDisplacedFilesystemLease(
          lockPath,
          releasePath,
          releasedOwner,
          createExclusive,
        );
      }
      await localFs.remove(releasePath);
    } catch (error) {
      if (!isNotFoundError(error)) {
        logger.debug(`${LOG_PREFIX_MDX_LOADER} Failed to release JSX cache lease`, {
          error: cacheFilesystemErrorCode(error),
        });
        scheduleJsxCachePruneRetry(dirname(lockPath), JSX_CACHE_PRUNE_RETRY_SLACK_MS);
      }
    } finally {
      if (transitionOwner !== undefined) {
        await removeFilesystemLeaseTransitionIfOwned(lockPath, transitionOwner);
      }
    }
  }
}

/**
 * Serialize the operations on one artifact path that must not interleave: a
 * cache hit verifying the file and recording it as served, a transform
 * rewriting it, and a prune pass removing it. Without this, a hit could verify
 * the artifact after the pruner checked the served memo but before its
 * `remove` landed, and the rewritten parent would import a just-deleted path.
 */
export async function withJsxArtifactLock<T>(
  artifactPath: string,
  operation: (assertLeaseOwned: () => Promise<void>) => Promise<T>,
  options: { waitForLiveLease?: boolean } = {},
): Promise<T> {
  const previous = jsxArtifactLocks.get(artifactPath) ?? Promise.resolve();
  const run = previous.then(() =>
    withFilesystemLease(
      `${artifactPath}.lock`,
      operation,
      options.waitForLiveLease ?? false,
    )
  );
  const settled = run.then(
    () => undefined,
    () => undefined,
  );
  jsxArtifactLocks.set(artifactPath, settled);
  void settled.then(() => {
    if (jsxArtifactLocks.get(artifactPath) === settled) {
      jsxArtifactLocks.delete(artifactPath);
    }
  });
  return await run;
}

async function readArtifactModifiedAtMs(path: string): Promise<number> {
  return await withJsxArtifactRefreshSlot(async () => {
    try {
      return (await getLocalFs().stat(path)).mtime?.getTime() ?? 0;
    } catch (error) {
      if (isNotFoundError(error)) {
        // A concurrent transform may have removed the variant already.
        return 0;
      }
      throw error;
    }
  });
}

/** Slack a scheduled follow-up adds so the variants it targets have aged out. */
const JSX_CACHE_PRUNE_RETRY_SLACK_MS = 1_000;

/**
 * Bound on the cache directories holding a pending follow-up prune.
 *
 * One runtime process can serve many projects, and an idle-horizon follow-up
 * stays pending for hours, so the pending set is capped like the other memos
 * here. Directories beyond the timer bound wait in a second bounded queue and
 * are promoted as timers fire, so capacity never starts a recursive scan loop.
 */
const MAX_PENDING_JSX_CACHE_PRUNE_DIRECTORIES = 256;
const JSX_CACHE_PRUNE_REQUEST_DIRECTORY = ".jsx-prune-requests-v1";
const JSX_CACHE_PRUNE_REQUEST_PREFIX = "request-";

interface PersistedJsxCachePruneRequest {
  esmCacheDir: string;
  fireAtMs: number;
  generation: string;
}

interface ScheduledJsxCachePrune {
  timer: ReturnType<typeof setTimeout> | undefined;
  fireAtMs: number;
  persistedGeneration?: string;
}

interface QueuedJsxCachePrune {
  fireAtMs: number;
  persistedGeneration?: string;
}

/** At most one pending follow-up prune per cache directory. */
const scheduledJsxCachePrunes = new Map<string, ScheduledJsxCachePrune>();
const queuedJsxCachePrunes = new Map<string, QueuedJsxCachePrune>();
const pendingJsxCachePersistence = new Map<
  string,
  { fireAtMs: number; requestDirectory: string }
>();
let jsxCachePersistencePump: Promise<void> | undefined;
let jsxCachePersistenceRetry: ReturnType<typeof setTimeout> | undefined;
const inFlightJsxCachePrunes = new Set<string>();
let persistedJsxCachePrunePromotion: Promise<void> | undefined;
let persistedJsxCachePrunePromotionRequested = false;
let persistedJsxCachePrunePromotionRetry: ReturnType<typeof setTimeout> | undefined;

function getPersistedJsxCachePruneRequestDirectory(): string {
  return join(getMdxEsmCacheDir(), JSX_CACHE_PRUNE_REQUEST_DIRECTORY);
}

async function getPersistedJsxCachePruneRequestPath(
  esmCacheDir: string,
  requestDirectory = getPersistedJsxCachePruneRequestDirectory(),
): Promise<string> {
  return join(
    requestDirectory,
    `${JSX_CACHE_PRUNE_REQUEST_PREFIX}${await computeHash(esmCacheDir)}.json`,
  );
}

async function persistJsxCachePruneRequest(
  esmCacheDir: string,
  fireAtMs: number,
  requestDirectory = getPersistedJsxCachePruneRequestDirectory(),
): Promise<string | undefined> {
  const localFs = getLocalFs();
  try {
    await localFs.mkdir(requestDirectory, { recursive: true });
    const requestPath = await getPersistedJsxCachePruneRequestPath(esmCacheDir, requestDirectory);
    return await withJsxArtifactLock(requestPath, async (assertLeaseOwned) => {
      let effectiveFireAtMs = fireAtMs;
      try {
        const existing = IntrinsicJSONParse(await localFs.readTextFile(requestPath));
        if (
          typeof existing === "object" && existing !== null &&
          (existing as { esmCacheDir?: unknown }).esmCacheDir === esmCacheDir &&
          typeof (existing as { fireAtMs?: unknown }).fireAtMs === "number"
        ) {
          effectiveFireAtMs = Math.min(
            (existing as { fireAtMs: number }).fireAtMs,
            fireAtMs,
          );
          // A sweep may already be processing the existing generation. Every
          // new request needs a fresh identity so that sweep cannot retire it.
        }
      } catch { /* a missing or malformed request is replaced below */ }
      const request = IntrinsicObjectCreate(null) as PersistedJsxCachePruneRequest;
      request.esmCacheDir = esmCacheDir;
      request.fireAtMs = effectiveFireAtMs;
      request.generation = cryptoRandomUUID();
      await assertLeaseOwned();
      await localFs.writeTextFile(
        requestPath,
        IntrinsicJSONStringify(request),
      );
      return request.generation;
    });
  } catch (error) {
    logger.debug(`${LOG_PREFIX_MDX_LOADER} Failed to persist JSX cache prune request`, {
      error: cacheFilesystemErrorCode(error),
    });
    return undefined;
  }
}

async function removePersistedJsxCachePruneRequest(path: string): Promise<void> {
  try {
    await getLocalFs().remove(path);
  } catch (error) {
    if (!isNotFoundError(error)) {
      logger.debug(`${LOG_PREFIX_MDX_LOADER} Failed to retire JSX cache prune request`, {
        error: cacheFilesystemErrorCode(error),
      });
    }
  }
}

async function readPersistedJsxCachePruneRequest(
  path: string,
): Promise<PersistedJsxCachePruneRequest | undefined> {
  const parseRequest = (source: string): PersistedJsxCachePruneRequest | undefined => {
    let request: unknown;
    try {
      request = IntrinsicJSONParse(source);
    } catch {
      return undefined;
    }
    if (
      typeof request !== "object" || request === null ||
      typeof (request as { esmCacheDir?: unknown }).esmCacheDir !== "string" ||
      typeof (request as { fireAtMs?: unknown }).fireAtMs !== "number" ||
      typeof (request as { generation?: unknown }).generation !== "string"
    ) return undefined;
    return request as PersistedJsxCachePruneRequest;
  };

  let source: string;
  try {
    source = await getLocalFs().readTextFile(path);
  } catch (error) {
    if (isNotFoundError(error)) return undefined;
    throw error;
  }
  const request = parseRequest(source);
  if (request !== undefined) return request;

  // Invalid data may only be a partial non-atomic write from another process.
  // Take the writer's lease, then re-read before deciding that deletion is
  // safe. Valid requests stay on the lock-free scan path.
  return await withJsxArtifactLock(path, async (assertLeaseOwned) => {
    try {
      source = await getLocalFs().readTextFile(path);
    } catch (error) {
      if (isNotFoundError(error)) return undefined;
      throw error;
    }
    const lockedRequest = parseRequest(source);
    if (lockedRequest !== undefined) return lockedRequest;
    await assertLeaseOwned();
    await removePersistedJsxCachePruneRequest(path);
    return undefined;
  });
}

async function retirePersistedJsxCachePruneRequest(
  esmCacheDir: string,
  expectedGeneration: string,
): Promise<void> {
  const path = await getPersistedJsxCachePruneRequestPath(esmCacheDir);
  try {
    await withJsxArtifactLock(path, async (assertLeaseOwned) => {
      const current = IntrinsicJSONParse(await getLocalFs().readTextFile(path));
      if (
        typeof current !== "object" || current === null ||
        (current as { esmCacheDir?: unknown }).esmCacheDir !== esmCacheDir ||
        (current as { generation?: unknown }).generation !== expectedGeneration
      ) return;
      await assertLeaseOwned();
      await removePersistedJsxCachePruneRequest(path);
    });
  } catch (error) {
    if (!isNotFoundError(error)) {
      logger.debug(`${LOG_PREFIX_MDX_LOADER} Failed to retire completed JSX prune request`, {
        error: cacheFilesystemErrorCode(error),
      });
    }
  }
}

async function promotePersistedJsxCachePruneRequest(): Promise<void> {
  const queuedCandidates = [...queuedJsxCachePrunes].sort(
    (left, right) => left[1].fireAtMs - right[1].fireAtMs,
  );
  const persistedCandidates: PersistedJsxCachePruneRequest[] = [];
  const requestDirectory = getPersistedJsxCachePruneRequestDirectory();
  let requestTombstoneRetryAtMs: number | undefined;
  const noteRequestMaintenanceRetry = (readyAtMs: number) => {
    requestTombstoneRetryAtMs = requestTombstoneRetryAtMs === undefined
      ? readyAtMs
      : Math.min(requestTombstoneRetryAtMs, readyAtMs);
  };
  const retainPersistedCandidate = (request: PersistedJsxCachePruneRequest): void => {
    let index = persistedCandidates.findIndex((candidate) => candidate.fireAtMs > request.fireAtMs);
    if (index === -1) index = persistedCandidates.length;
    persistedCandidates.splice(index, 0, request);
    if (persistedCandidates.length > MAX_PENDING_JSX_CACHE_PRUNE_DIRECTORIES) {
      persistedCandidates.pop();
    }
  };
  try {
    const localFs = getLocalFs();
    const nowMs = Date.now();
    for await (const entry of getLocalFs().readDir(requestDirectory)) {
      if (entry.isFile && isJsxLeaseTombstoneName(entry.name)) {
        const retryAtMs = await sweepJsxLeaseTombstones(
          requestDirectory,
          [entry.name],
          nowMs,
        );
        if (retryAtMs !== undefined) noteRequestMaintenanceRetry(retryAtMs);
        continue;
      }
      if (entry.isFile && isJsxLeaseTransitionName(entry.name)) {
        const retryAtMs = await sweepJsxLeaseTransitions(
          requestDirectory,
          [entry.name],
          nowMs,
        );
        if (retryAtMs !== undefined) noteRequestMaintenanceRetry(retryAtMs);
        continue;
      }
      if (
        entry.isFile && entry.name.startsWith(JSX_CACHE_PRUNE_REQUEST_PREFIX) &&
        entry.name.endsWith(".json.lock")
      ) {
        const requestName = entry.name.slice(0, -".lock".length);
        if (await localFs.exists(join(requestDirectory, requestName))) continue;
        const lockPath = join(requestDirectory, entry.name);
        const modifiedAtMs = await readArtifactModifiedAtMs(lockPath);
        if (modifiedAtMs === 0) continue;
        const recoverAtMs = modifiedAtMs + JSX_ARTIFACT_LEASE_STALE_MS;
        if (recoverAtMs > nowMs) {
          noteRequestMaintenanceRetry(recoverAtMs);
          continue;
        }
        await withJsxArtifactLock(join(requestDirectory, requestName), async () => undefined);
        continue;
      }
      if (
        !entry.isFile || !entry.name.startsWith(JSX_CACHE_PRUNE_REQUEST_PREFIX) ||
        !entry.name.endsWith(".json")
      ) continue;
      const requestPath = join(requestDirectory, entry.name);
      const request = await readPersistedJsxCachePruneRequest(requestPath);
      if (request === undefined) continue;
      const { esmCacheDir, fireAtMs, generation } = request;
      if (
        scheduledJsxCachePrunes.has(esmCacheDir) || queuedJsxCachePrunes.has(esmCacheDir) ||
        inFlightJsxCachePrunes.has(esmCacheDir)
      ) {
        continue;
      }
      retainPersistedCandidate({ esmCacheDir, fireAtMs, generation });
    }
  } catch (error) {
    if (!isNotFoundError(error)) {
      logger.debug(`${LOG_PREFIX_MDX_LOADER} Failed to read persisted JSX prune requests`, {
        error: cacheFilesystemErrorCode(error),
      });
      requestTombstoneRetryAtMs = Date.now() + JSX_CACHE_VARIANT_MIN_AGE_MS;
    }
  }
  let queuedIndex = 0;
  let persistedIndex = 0;
  if (scheduledJsxCachePrunes.size >= MAX_PENDING_JSX_CACHE_PRUNE_DIRECTORIES) {
    const queued = queuedCandidates[queuedIndex];
    const persisted = persistedCandidates[persistedIndex];
    if (
      persisted !== undefined && (queued === undefined || persisted.fireAtMs <= queued[1].fireAtMs)
    ) {
      persistedIndex++;
      scheduleJsxCachePruneRetry(
        persisted.esmCacheDir,
        Math.max(persisted.fireAtMs - Date.now(), 0),
        persisted.generation,
      );
    } else if (queued !== undefined) {
      queuedIndex++;
      queuedJsxCachePrunes.delete(queued[0]);
      scheduleJsxCachePruneRetry(
        queued[0],
        Math.max(queued[1].fireAtMs - Date.now(), 0),
        queued[1].persistedGeneration,
      );
    }
  }
  while (scheduledJsxCachePrunes.size < MAX_PENDING_JSX_CACHE_PRUNE_DIRECTORIES) {
    const queued = queuedCandidates[queuedIndex];
    const persisted = persistedCandidates[persistedIndex];
    if (queued === undefined && persisted === undefined) break;
    if (
      persisted !== undefined &&
      (queued === undefined || persisted.fireAtMs <= queued[1].fireAtMs)
    ) {
      persistedIndex++;
      scheduleJsxCachePruneRetry(
        persisted.esmCacheDir,
        Math.max(persisted.fireAtMs - Date.now(), 0),
        persisted.generation,
      );
      continue;
    }
    if (queued !== undefined) {
      queuedIndex++;
      queuedJsxCachePrunes.delete(queued[0]);
      scheduleJsxCachePruneRetry(
        queued[0],
        Math.max(queued[1].fireAtMs - Date.now(), 0),
        queued[1].persistedGeneration,
      );
    }
  }
  if (requestTombstoneRetryAtMs !== undefined) {
    // Request cleanup has its own eventual slot, but must not take the only
    // slot a persisted project request with an earlier deadline just freed.
    scheduleJsxCachePruneRetry(
      requestDirectory,
      Math.max(requestTombstoneRetryAtMs - Date.now(), 0) + JSX_CACHE_PRUNE_RETRY_SLACK_MS,
    );
  }
}

function requestPersistedJsxCachePrunePromotion(): void {
  if (persistedJsxCachePrunePromotionRetry !== undefined) return;
  if (persistedJsxCachePrunePromotion !== undefined) {
    persistedJsxCachePrunePromotionRequested = true;
    return;
  }
  persistedJsxCachePrunePromotionRequested = false;
  const promotion = promotePersistedJsxCachePruneRequest().catch(() => {
    // A full persistence tier must defer background promotion, not reject an
    // unobserved promise. Admission keeps the old timer until queueing succeeds.
    persistedJsxCachePrunePromotionRetry = setTimeout(() => {
      persistedJsxCachePrunePromotionRetry = undefined;
      requestPersistedJsxCachePrunePromotion();
    }, JSX_CACHE_PRUNE_RETRY_SLACK_MS);
    unrefTimer(persistedJsxCachePrunePromotionRetry);
  });
  persistedJsxCachePrunePromotion = promotion;
  void promotion.finally(() => {
    if (persistedJsxCachePrunePromotion === promotion) {
      persistedJsxCachePrunePromotion = undefined;
      if (persistedJsxCachePrunePromotionRequested) {
        requestPersistedJsxCachePrunePromotion();
      }
    }
  });
}

function pumpJsxCachePersistence(): void {
  if (jsxCachePersistencePump !== undefined || jsxCachePersistenceRetry !== undefined) return;
  const pump = (async () => {
    for (const [directory, request] of [...pendingJsxCachePersistence]) {
      if (pendingJsxCachePersistence.get(directory) !== request) continue;
      const generation = await persistJsxCachePruneRequest(
        directory,
        request.fireAtMs,
        request.requestDirectory,
      );
      if (generation !== undefined && pendingJsxCachePersistence.get(directory) === request) {
        pendingJsxCachePersistence.delete(directory);
        requestPersistedJsxCachePrunePromotion();
      }
    }
  })();
  jsxCachePersistencePump = pump;
  void pump.finally(() => {
    jsxCachePersistencePump = undefined;
    if (pendingJsxCachePersistence.size === 0) return;
    jsxCachePersistenceRetry = setTimeout(() => {
      jsxCachePersistenceRetry = undefined;
      pumpJsxCachePersistence();
    }, JSX_CACHE_PRUNE_RETRY_SLACK_MS);
    unrefTimer(jsxCachePersistenceRetry);
  });
}

function queueJsxCachePrune(
  esmCacheDir: string,
  fireAtMs: number,
  persistedGeneration?: string,
): void {
  const queued = queuedJsxCachePrunes.get(esmCacheDir);
  if (queued !== undefined) {
    if (fireAtMs < queued.fireAtMs || queued.persistedGeneration === undefined) {
      queuedJsxCachePrunes.set(esmCacheDir, {
        fireAtMs: Math.min(fireAtMs, queued.fireAtMs),
        persistedGeneration: queued.persistedGeneration ?? persistedGeneration,
      });
    }
    return;
  }
  if (queuedJsxCachePrunes.size >= MAX_PENDING_JSX_CACHE_PRUNE_DIRECTORIES) {
    const pending = pendingJsxCachePersistence.get(esmCacheDir);
    if (
      pending === undefined &&
      pendingJsxCachePersistence.size >= MAX_PENDING_JSX_CACHE_PRUNE_DIRECTORIES
    ) {
      throw new JsxCacheCapacityError("JSX cache maintenance backlog is exhausted");
    }
    pendingJsxCachePersistence.set(esmCacheDir, {
      fireAtMs: Math.min(fireAtMs, pending?.fireAtMs ?? fireAtMs),
      requestDirectory: pending?.requestDirectory ?? getPersistedJsxCachePruneRequestDirectory(),
    });
    pumpJsxCachePersistence();
    return;
  }
  queuedJsxCachePrunes.set(esmCacheDir, { fireAtMs, persistedGeneration });
}

async function revisitJsxCacheDirectory(esmCacheDir: string): Promise<void> {
  try {
    await scheduledJsxCachePruneSemaphore.acquire(() =>
      collectExcessJsxArtifacts(esmCacheDir, new Map(), Date.now()).then(() => undefined)
    );
  } catch (error) {
    logger.debug(`${LOG_PREFIX_MDX_LOADER} Scheduled JSX cache prune failed`, {
      error: cacheFilesystemErrorCode(error),
    });
    // A pass that throws, rather than preserving an artifact and naming a
    // retry, never reaches the scheduling at its end. Re-arm the directory so
    // transient lease or filesystem failures cannot strand its excess files.
    scheduleJsxCachePruneRetry(
      esmCacheDir,
      JSX_CACHE_VARIANT_MIN_AGE_MS + JSX_CACHE_PRUNE_RETRY_SLACK_MS,
    );
  }
}

/**
 * Schedule a follow-up prune for variants a preservation rule protected.
 *
 * The prune pass otherwise runs only when a transform writes an artifact, so a
 * burst that puts a path over its window inside one grace period and then goes
 * idle would leave the excess on disk until an unrelated future write. One
 * timer per directory, always at the earliest requested deadline: a pending
 * idle-horizon follow-up hours out must not swallow a grace-period retry due
 * in seconds. The timer is unref'd: cleanup of superseded cache files is never
 * a reason to keep the process alive.
 */
function scheduleJsxCachePruneRetry(
  esmCacheDir: string,
  delayMs: number,
  persistedGeneration?: string,
): void {
  const fireAtMs = Date.now() + delayMs;
  const pending = scheduledJsxCachePrunes.get(esmCacheDir);
  if (pending) {
    if (pending.timer !== undefined && pending.fireAtMs <= fireAtMs) return;
    if (pending.timer !== undefined) clearTimeout(pending.timer);
  } else if (scheduledJsxCachePrunes.size >= MAX_PENDING_JSX_CACHE_PRUNE_DIRECTORIES) {
    let latest: [string, ScheduledJsxCachePrune] | undefined;
    for (const candidate of scheduledJsxCachePrunes) {
      if (
        candidate[1].timer !== undefined && candidate[1].fireAtMs > fireAtMs &&
        (latest === undefined || candidate[1].fireAtMs > latest[1].fireAtMs)
      ) latest = candidate;
    }
    if (latest === undefined) {
      queueJsxCachePrune(esmCacheDir, fireAtMs, persistedGeneration);
      return;
    }
    queueJsxCachePrune(
      latest[0],
      latest[1].fireAtMs,
      latest[1].persistedGeneration,
    );
    clearTimeout(latest[1].timer!);
    scheduledJsxCachePrunes.delete(latest[0]);
  }
  const timer = setTimeout(() => {
    const fired = scheduledJsxCachePrunes.get(esmCacheDir);
    if (fired?.timer !== timer) return;
    // Keep the map entry as this pass's reserved timer slot. A follow-up that
    // the pass schedules can then replace it even when every other slot is
    // occupied, without overflowing to persistence and racing completion.
    fired.timer = undefined;
    void (async () => {
      inFlightJsxCachePrunes.add(esmCacheDir);
      try {
        await revisitJsxCacheDirectory(esmCacheDir);
        const followUp = scheduledJsxCachePrunes.get(esmCacheDir);
        if (
          followUp?.timer === undefined &&
          !queuedJsxCachePrunes.has(esmCacheDir) &&
          fired.persistedGeneration !== undefined
        ) {
          await retirePersistedJsxCachePruneRequest(
            esmCacheDir,
            fired.persistedGeneration,
          );
        }
      } finally {
        inFlightJsxCachePrunes.delete(esmCacheDir);
        if (scheduledJsxCachePrunes.get(esmCacheDir)?.timer === undefined) {
          scheduledJsxCachePrunes.delete(esmCacheDir);
        }
        requestPersistedJsxCachePrunePromotion();
      }
    })();
  }, delayMs);
  unrefTimer(timer);
  scheduledJsxCachePrunes.set(esmCacheDir, {
    timer,
    fireAtMs,
    persistedGeneration: pending?.persistedGeneration ?? persistedGeneration,
  });
}

/**
 * Keep an age-based sweep armed for a cache directory a transform is using.
 *
 * Scheduled follow-up prunes live in process memory, so a process restart
 * loses them, and a replacement process serving an unchanged project entirely
 * from cache writes no artifact and would otherwise never scan. Arming a sweep
 * whenever the directory has no pending pass restores age-based collection for
 * that process, and keeps it running for artifacts another process retired,
 * at a cost of at most one directory scan per grace period per active
 * directory. It fires one grace period out: nothing younger is collectable,
 * and deferring it keeps a process's startup burst free of an extra scan.
 */
export function ensureJsxCacheSweepArmed(esmCacheDir: string): void {
  if (scheduledJsxCachePrunes.has(esmCacheDir) || queuedJsxCachePrunes.has(esmCacheDir)) return;
  scheduleJsxCachePruneRetry(
    esmCacheDir,
    JSX_CACHE_VARIANT_MIN_AGE_MS + JSX_CACHE_PRUNE_RETRY_SLACK_MS,
  );
  requestPersistedJsxCachePrunePromotion();
}

/** Drop every pending follow-up prune (test isolation only). */
function cancelScheduledJsxCachePrunes(): void {
  for (const pending of scheduledJsxCachePrunes.values()) {
    if (pending.timer !== undefined) clearTimeout(pending.timer);
  }
  scheduledJsxCachePrunes.clear();
  queuedJsxCachePrunes.clear();
  pendingJsxCachePersistence.clear();
  if (persistedJsxCachePrunePromotionRetry !== undefined) {
    clearTimeout(persistedJsxCachePrunePromotionRetry);
    persistedJsxCachePrunePromotionRetry = undefined;
  }
  if (jsxCachePersistenceRetry !== undefined) {
    clearTimeout(jsxCachePersistenceRetry);
    jsxCachePersistenceRetry = undefined;
  }
  if (lazyJsxArtifactHeartbeat !== undefined) {
    clearInterval(lazyJsxArtifactHeartbeat);
    lazyJsxArtifactHeartbeat = undefined;
  }
  lazyJsxArtifactExpirations.clear();
}

async function waitForJsxCacheMaintenanceForTests(): Promise<void> {
  while (
    jsxCachePersistencePump !== undefined || persistedJsxCachePrunePromotion !== undefined
  ) {
    await Promise.allSettled(
      [jsxCachePersistencePump, persistedJsxCachePrunePromotion].filter(
        (pending): pending is Promise<void> => pending !== undefined,
      ),
    );
  }
}

async function hasPersistedJsxCachePrune(esmCacheDir: string): Promise<boolean> {
  try {
    for await (const entry of getLocalFs().readDir(getPersistedJsxCachePruneRequestDirectory())) {
      if (!entry.isFile || !entry.name.startsWith(JSX_CACHE_PRUNE_REQUEST_PREFIX)) continue;
      try {
        const request = IntrinsicJSONParse(
          await getLocalFs().readTextFile(
            join(getPersistedJsxCachePruneRequestDirectory(), entry.name),
          ),
        );
        if (
          typeof request === "object" && request !== null &&
          (request as { esmCacheDir?: unknown }).esmCacheDir === esmCacheDir
        ) return true;
      } catch { /* malformed requests are ignored here and retired by the pump */ }
    }
  } catch (error) {
    if (!isNotFoundError(error)) throw error;
  }
  return false;
}

async function clearPersistedJsxCachePruneRequestsForTests(
  directoryPrefix: string,
): Promise<void> {
  try {
    const requestDirectory = getPersistedJsxCachePruneRequestDirectory();
    for await (const entry of getLocalFs().readDir(requestDirectory)) {
      if (!entry.isFile || !entry.name.startsWith(JSX_CACHE_PRUNE_REQUEST_PREFIX)) continue;
      const path = join(requestDirectory, entry.name);
      try {
        const request = IntrinsicJSONParse(await getLocalFs().readTextFile(path));
        if (
          typeof request === "object" && request !== null &&
          typeof (request as { esmCacheDir?: unknown }).esmCacheDir === "string" &&
          (request as { esmCacheDir: string }).esmCacheDir.startsWith(directoryPrefix)
        ) await removePersistedJsxCachePruneRequest(path);
      } catch { /* malformed requests are owned by the production pump */ }
    }
  } catch (error) {
    if (!isNotFoundError(error)) throw error;
  }
}

export class JsxCacheCapacityError extends Error {
  override name = "JsxCacheCapacityError";
}

function isJsxArtifactName(name: string): boolean {
  return name.startsWith(MDX_JSX_CACHE_ROOT_PREFIX) && name.endsWith(".mjs");
}

async function countCurrentNamespaceJsxArtifacts(esmCacheDir: string): Promise<number> {
  let count = 0;
  for await (const entry of getLocalFs().readDir(esmCacheDir)) {
    if (
      entry.isFile && entry.name.startsWith(MDX_JSX_CACHE_NAMESPACE_PREFIX) &&
      entry.name.endsWith(".mjs")
    ) count++;
  }
  return count;
}

/** Reserve one directory-wide artifact slot and hold it through the write. */
export function withJsxArtifactWriteCapacity<T>(
  esmCacheDir: string,
  artifactPath: string,
  operation: (assertCapacityLeaseOwned: () => Promise<void>) => Promise<T>,
): Promise<T> {
  return withJsxArtifactLock(
    join(esmCacheDir, JSX_DIRECTORY_QUOTA_LOCK_BASE_NAME),
    async (assertLeaseOwned) => {
      await assertLeaseOwned();
      if (await getLocalFs().exists(artifactPath)) {
        await assertLeaseOwned();
        return await operation(assertLeaseOwned);
      }
      let remainingArtifacts = await countCurrentNamespaceJsxArtifacts(esmCacheDir);
      if (remainingArtifacts >= MAX_JSX_CACHE_ARTIFACTS_PER_DIRECTORY) {
        await assertLeaseOwned();
        remainingArtifacts = await collectExcessJsxArtifacts(
          esmCacheDir,
          new Map(),
          Date.now(),
          1,
        ) ?? await countCurrentNamespaceJsxArtifacts(esmCacheDir);
      }
      if (remainingArtifacts >= MAX_JSX_CACHE_ARTIFACTS_PER_DIRECTORY) {
        throw new JsxCacheCapacityError("JSX cache artifact quota is exhausted");
      }
      await assertLeaseOwned();
      return await operation(assertLeaseOwned);
    },
    { waitForLiveLease: true },
  );
}

/** Outcome of one removal attempt; a preserved artifact names its retry time. */
type JsxArtifactRemoval = { removed: true } | { removed: false; retryAtMs: number };

/**
 * Remove one artifact unless a render still holds it.
 *
 * The re-checks run under the same per-path lock the cache-hit verification
 * runs under, so selection and removal cannot interleave: a hit that got the
 * lock first has marked the artifact served (or pinned it with an active
 * reference) by the time these checks run, and a removal that got there first
 * leaves the hit a missing file, which it reports as a miss and regenerates.
 * A preserved artifact reports when it next becomes collectable so the caller
 * can schedule a follow-up rather than wait for an unrelated future write.
 */
async function removeJsxArtifactUnlessServed(
  artifactPath: string,
  nowMs: number,
): Promise<JsxArtifactRemoval> {
  return await withJsxArtifactLock(artifactPath, async (assertLeaseOwned) => {
    const checkedAtMs = Math.max(nowMs, Date.now());
    if (
      jsxArtifactActiveRefs.has(artifactPath) ||
      isLazyJsxArtifactRetained(artifactPath, checkedAtMs)
    ) {
      // Release time is the parent import settling, which has no schedule of
      // its own; poll again one grace period out.
      return { removed: false, retryAtMs: checkedAtMs + JSX_CACHE_VARIANT_MIN_AGE_MS };
    }
    const servedAtMs = servedArtifactTimestamps.get(artifactPath);
    if (servedAtMs !== undefined && checkedAtMs - servedAtMs < JSX_CACHE_VARIANT_MIN_AGE_MS) {
      return { removed: false, retryAtMs: servedAtMs + JSX_CACHE_VARIANT_MIN_AGE_MS };
    }
    // The memos above are process-local, but the selection this removal acts
    // on may be a scan old enough for another process (one draining during a
    // rolling deploy) to have cache-hit the artifact and refreshed its mtime
    // in the meantime. The shared mtime is re-read here, under the lock and
    // immediately before the remove, so that refresh is honored rather than
    // raced: an artifact another process just marked in use gets a fresh grace
    // period instead of a deletion.
    const modifiedAtMs = await readArtifactModifiedAtMs(artifactPath);
    if (modifiedAtMs > 0 && checkedAtMs - modifiedAtMs < JSX_CACHE_VARIANT_MIN_AGE_MS) {
      return { removed: false, retryAtMs: modifiedAtMs + JSX_CACHE_VARIANT_MIN_AGE_MS };
    }
    try {
      await assertLeaseOwned();
      await getLocalFs().remove(artifactPath);
    } catch (error) {
      if (!isNotFoundError(error)) {
        logger.debug(`${LOG_PREFIX_MDX_LOADER} Failed to remove JSX cache artifact`, {
          error: cacheFilesystemErrorCode(error),
        });
        return {
          removed: false,
          retryAtMs: checkedAtMs + JSX_CACHE_VARIANT_MIN_AGE_MS,
        };
      }
      // A concurrent transform already removed the artifact.
    }
    mtimeRefreshTimestamps.delete(artifactPath);
    return { removed: true };
  });
}

/**
 * Retire the oldest cached content variants of every source path in the cache.
 *
 * Artifact names are content-keyed, so a project that keeps changing the same
 * path would otherwise accumulate one persistent `jsx-*.mjs` file per variant.
 *
 * The pass covers every path the directory holds, not only the paths this
 * transform wrote: a burst of changes can leave a path over its window with
 * every variant still inside the grace period, and if the writer stopped there
 * would be nothing left to trigger its cleanup. Recovering each entry's
 * per-path prefix from its own fixed-width name keeps that generality at one
 * `readDir` and one map lookup per entry, rather than multiplying entries by
 * the number of paths written.
 *
 * It runs only after a transform wrote something, so a render served entirely
 * from cache never pays for it; a pass that has to leave over-window variants
 * behind schedules its own follow-up instead of waiting for a future write.
 */
export async function pruneSupersededJsxArtifacts(
  esmCacheDir: string,
  writtenArtifacts: ReadonlyMap<string, string>,
  nowMs: number = Date.now(),
): Promise<void> {
  if (writtenArtifacts.size === 0) return;

  const currentByPrefix = new Map<string, string>();
  for (const [filePath, currentFileName] of writtenArtifacts) {
    currentByPrefix.set(buildMdxJsxCacheFileNamePrefix(filePath), currentFileName);
  }
  await collectExcessJsxArtifacts(esmCacheDir, currentByPrefix, nowMs);
}

/**
 * One prune pass over `esmCacheDir`. `currentByPrefix` protects the artifacts
 * the caller just wrote; a scheduled follow-up passes none and relies on the
 * grace period and idle floor alone. Beyond the per-path variant window, the
 * pass retires any variant idle past {@link JSX_CACHE_VARIANT_MAX_IDLE_AGE_MS}
 * (the directory-wide backstop that keeps retired source paths from leaking
 * one artifact each) and reclaims artifacts stranded under a superseded
 * cache namespace: recognisably this loader's files, but unreachable since the
 * roll, so no variant window can ever cover them again. It also sweeps the
 * lease tombstones and transition fences a recovery could not remove itself,
 * which nothing else in the directory accounts for.
 */
async function readJsxArtifactDates(
  directory: string,
  names: readonly string[],
): Promise<Array<{ name: string; modifiedAtMs: number }>> {
  const dated: Array<{ name: string; modifiedAtMs: number }> = [];
  let next = 0;
  const workers = Array.from(
    { length: Math.min(JSX_ARTIFACT_REFRESH_CONCURRENCY, names.length) },
    async () => {
      while (next < names.length) {
        const index = next++;
        const name = names[index]!;
        const modifiedAtMs = await readArtifactModifiedAtMs(join(directory, name));
        dated[index] = { name, modifiedAtMs };
      }
    },
  );
  await Promise.all(workers);
  return dated;
}

async function collectExcessJsxArtifacts(
  esmCacheDir: string,
  currentByPrefix: ReadonlyMap<string, string>,
  nowMs: number,
  reservedSlots = 0,
): Promise<number | undefined> {
  const localFs = getLocalFs();

  const variantsByPrefix = new Map<string, string[]>();
  const strandedNamespaceArtifacts: string[] = [];
  const leaseTombstones: string[] = [];
  const leaseTransitions: string[] = [];
  const possibleOrphanLeaseArtifacts: Array<{ artifactName: string; lockName: string }> = [];
  const allArtifactNames: string[] = [];
  try {
    for await (const entry of localFs.readDir(esmCacheDir)) {
      if (!entry.isFile) continue;
      if (isJsxLeaseTombstoneName(entry.name)) {
        leaseTombstones.push(entry.name);
        continue;
      }
      if (isJsxLeaseTransitionName(entry.name)) {
        leaseTransitions.push(entry.name);
        continue;
      }
      if (entry.name.endsWith(".mjs.lock")) {
        const artifactName = entry.name.slice(0, -".lock".length);
        if (isJsxArtifactName(artifactName)) {
          possibleOrphanLeaseArtifacts[possibleOrphanLeaseArtifacts.length] = {
            artifactName,
            lockName: entry.name,
          };
        }
        continue;
      }
      if (!entry.name.endsWith(".mjs")) continue;
      if (isJsxArtifactName(entry.name)) allArtifactNames.push(entry.name);
      if (!entry.name.startsWith(MDX_JSX_CACHE_NAMESPACE_PREFIX)) {
        if (entry.name.startsWith(MDX_JSX_CACHE_ROOT_PREFIX)) {
          strandedNamespaceArtifacts.push(entry.name);
        }
        continue;
      }
      if (entry.name.length <= MDX_JSX_CACHE_FILE_NAME_PREFIX_LENGTH) continue;

      const prefix = entry.name.slice(0, MDX_JSX_CACHE_FILE_NAME_PREFIX_LENGTH);
      if (entry.name === currentByPrefix.get(prefix)) continue;

      const variants = variantsByPrefix.get(prefix);
      if (variants) variants.push(entry.name);
      else variantsByPrefix.set(prefix, [entry.name]);
    }
  } catch (error) {
    logger.debug(`${LOG_PREFIX_MDX_LOADER} Failed to scan JSX cache artifacts for pruning`, {
      error: cacheFilesystemErrorCode(error),
    });
    if (!isNotFoundError(error)) {
      scheduleJsxCachePruneRetry(
        esmCacheDir,
        JSX_CACHE_VARIANT_MIN_AGE_MS + JSX_CACHE_PRUNE_RETRY_SLACK_MS,
      );
    }
    return undefined;
  }

  let remainingCurrentNamespaceArtifacts =
    allArtifactNames.filter((name) => name.startsWith(MDX_JSX_CACHE_NAMESPACE_PREFIX)).length;
  const noteArtifactRemoval = (name: string, removal: JsxArtifactRemoval): void => {
    if (removal.removed && name.startsWith(MDX_JSX_CACHE_NAMESPACE_PREFIX)) {
      remainingCurrentNamespaceArtifacts--;
    }
  };

  /** Earliest moment a variant this pass left behind becomes collectable. */
  let retryAtMs: number | undefined;
  const noteRetry = (readyAtMs: number) => {
    retryAtMs = retryAtMs === undefined ? readyAtMs : Math.min(retryAtMs, readyAtMs);
  };

  const tombstoneRetryAtMs = await sweepJsxLeaseTombstones(
    esmCacheDir,
    leaseTombstones,
    nowMs,
  );
  if (tombstoneRetryAtMs !== undefined) noteRetry(tombstoneRetryAtMs);
  const transitionRetryAtMs = await sweepJsxLeaseTransitions(
    esmCacheDir,
    leaseTransitions,
    nowMs,
  );
  if (transitionRetryAtMs !== undefined) noteRetry(transitionRetryAtMs);

  const artifactNames = new Set(allArtifactNames);
  for (const { artifactName, lockName } of possibleOrphanLeaseArtifacts) {
    if (artifactNames.has(artifactName)) continue;
    const lockPath = join(esmCacheDir, lockName);
    const modifiedAtMs = await readArtifactModifiedAtMs(lockPath);
    if (modifiedAtMs === 0) continue;
    const recoverAtMs = modifiedAtMs + JSX_ARTIFACT_LEASE_STALE_MS;
    if (recoverAtMs > nowMs) {
      noteRetry(recoverAtMs);
      continue;
    }
    await withJsxArtifactLock(join(esmCacheDir, artifactName), async () => undefined);
  }

  const quotaHandled = new Set<string>();
  const strandedNamespaceNames = new Set(strandedNamespaceArtifacts);
  let directoryExcess = Math.max(
    0,
    allArtifactNames.filter((name) => name.startsWith(MDX_JSX_CACHE_NAMESPACE_PREFIX)).length +
      reservedSlots -
      MAX_JSX_CACHE_ARTIFACTS_PER_DIRECTORY,
  );
  if (directoryExcess > 0) {
    const protectedNames = new Set(currentByPrefix.values());
    const datedArtifacts = await readJsxArtifactDates(
      esmCacheDir,
      allArtifactNames
        .filter((name) => name.startsWith(MDX_JSX_CACHE_NAMESPACE_PREFIX))
        .filter((name) => !protectedNames.has(name)),
    );
    datedArtifacts.sort((left, right) => left.modifiedAtMs - right.modifiedAtMs);
    for (const { name, modifiedAtMs } of datedArtifacts) {
      if (directoryExcess === 0) break;
      const collectableAtMs = modifiedAtMs +
        (strandedNamespaceNames.has(name)
          ? JSX_CACHE_VARIANT_MAX_IDLE_AGE_MS
          : JSX_CACHE_VARIANT_MIN_AGE_MS);
      if (collectableAtMs > nowMs) {
        noteRetry(collectableAtMs);
        continue;
      }
      const removal = await removeJsxArtifactUnlessServed(join(esmCacheDir, name), nowMs);
      quotaHandled.add(name);
      if (removal.removed) {
        directoryExcess--;
        noteArtifactRemoval(name, removal);
      } else noteRetry(removal.retryAtMs);
    }
  }

  for (const name of strandedNamespaceArtifacts) {
    if (quotaHandled.has(name)) continue;
    const artifactPath = join(esmCacheDir, name);
    // Older runtimes do not refresh cache-hit mtimes. Keep prior-namespace
    // artifacts for the full idle horizon so a rolling deploy cannot retire a
    // module that a draining pre-heartbeat process still imports.
    const modifiedAtMs = await readArtifactModifiedAtMs(artifactPath);
    if (nowMs - modifiedAtMs < JSX_CACHE_VARIANT_MAX_IDLE_AGE_MS) {
      noteRetry(modifiedAtMs + JSX_CACHE_VARIANT_MAX_IDLE_AGE_MS);
      continue;
    }
    const removal = await removeJsxArtifactUnlessServed(artifactPath, nowMs);
    if (!removal.removed) noteRetry(removal.retryAtMs);
  }

  for (const [prefix, variants] of variantsByPrefix) {
    // The artifact just written, when there is one, counts against the window.
    const retained = MAX_JSX_CACHE_VARIANTS_PER_PATH - (currentByPrefix.has(prefix) ? 1 : 0);

    const dated = await readJsxArtifactDates(esmCacheDir, variants);
    dated.sort((left, right) => right.modifiedAtMs - left.modifiedAtMs);

    for (const [index, { name, modifiedAtMs }] of dated.entries()) {
      if (quotaHandled.has(name)) continue;
      const artifactPath = join(esmCacheDir, name);
      const servedAtMs = servedArtifactTimestamps.get(artifactPath) ?? 0;
      const lastUsedMs = Math.max(modifiedAtMs, servedAtMs);
      // A variant over the per-path window goes as soon as its grace period
      // ends. A variant inside the window is bounded by idle age instead:
      // without that, a path retired by a rename keeps its last variants
      // forever, and disk growth tracks edit history again. Cache hits refresh
      // mtime, so an artifact still being served never reads as idle.
      const collectableAtMs = index >= retained
        ? lastUsedMs + JSX_CACHE_VARIANT_MIN_AGE_MS
        : lastUsedMs + JSX_CACHE_VARIANT_MAX_IDLE_AGE_MS;
      if (collectableAtMs > nowMs) {
        noteRetry(collectableAtMs);
        continue;
      }
      const removal = await removeJsxArtifactUnlessServed(artifactPath, nowMs);
      if (removal.removed) noteArtifactRemoval(name, removal);
      else noteRetry(removal.retryAtMs);
    }
  }

  if (retryAtMs !== undefined) {
    scheduleJsxCachePruneRetry(
      esmCacheDir,
      Math.max(retryAtMs - nowMs, 0) + JSX_CACHE_PRUNE_RETRY_SLACK_MS,
    );
  }
  return remainingCurrentNamespaceArtifacts;
}

/**
 * Reachable for the cache-retention tests, which need to drive the memos, the
 * per-artifact lock and the prune pass directly rather than through a full
 * JSX transform: filling a memo through the transform would mean writing one
 * cache file per entry, and the prune's timing rules are not reachable from a
 * render that cannot age its own artifacts.
 */
export const __jsxCacheInternals = {
  cancelScheduledJsxCachePrunes,
  clearPersistedJsxCachePruneRequestsForTests,
  collectExcessJsxArtifacts,
  getPersistedJsxCachePruneRequestPath,
  hasScheduledJsxCachePrune: (esmCacheDir: string): boolean =>
    scheduledJsxCachePrunes.has(esmCacheDir) || queuedJsxCachePrunes.has(esmCacheDir),
  hasPersistedJsxCachePrune,
  isModuleRemembered: (transformedPath: string): boolean =>
    normalizedModulePaths.has(transformedPath),
  isLazyArtifactRetained: isLazyJsxArtifactRetained,
  JSX_ARTIFACT_LEASE_STALE_MS,
  JSX_ARTIFACT_REFRESH_CONCURRENCY,
  LAZY_JSX_ARTIFACT_RETENTION_MS,
  LAZY_JSX_ARTIFACT_HEARTBEAT_CONCURRENCY,
  jsxArtifactActiveRefCount: (artifactPath: string): number =>
    jsxArtifactActiveRefs.get(artifactPath) ?? 0,
  MAX_NORMALIZED_MODULE_MEMO_ENTRIES,
  MAX_PENDING_JSX_CACHE_PRUNE_DIRECTORIES,
  MAX_SERVED_ARTIFACT_MEMO_ENTRIES,
  normalizedModuleMemoSize: (): number => normalizedModulePaths.size,
  persistJsxCachePruneRequest,
  promotePersistedJsxCachePruneRequest,
  queueJsxCachePrune,
  queuedJsxCachePruneCount: (): number => queuedJsxCachePrunes.size,
  readArtifactModifiedAtMs,
  retirePersistedJsxCachePruneRequest,
  retainLazyJsxArtifact,
  releaseJsxArtifact,
  rememberNormalizedModule,
  removeJsxArtifactUnlessServed,
  retainJsxArtifact,
  scheduleJsxCachePruneRetry,
  SCHEDULED_JSX_CACHE_PRUNE_CONCURRENCY,
  scheduledJsxCachePruneCount: (): number => scheduledJsxCachePrunes.size,
  hasActiveScheduledJsxCachePrune: (esmCacheDir: string): boolean =>
    scheduledJsxCachePrunes.get(esmCacheDir)?.timer !== undefined,
  runLazyJsxArtifactHeartbeat,
  servedArtifactMemoSize: (): number => servedArtifactTimestamps.size,
  withJsxArtifactRefreshSlot,
  waitForJsxCacheMaintenanceForTests,
  wasJsxArtifactRecentlyServed,
};
