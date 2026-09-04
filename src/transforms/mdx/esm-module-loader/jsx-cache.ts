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

import { join } from "#veryfront/compat/path";
import { isAlreadyExistsError, isNotFoundError } from "#veryfront/platform/compat/fs.ts";
import { unrefTimer } from "#veryfront/platform/compat/process.ts";
import { rendererLogger as logger } from "#veryfront/utils";
import { isWithinDirectory } from "#veryfront/utils/path-utils.ts";
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

/** Bound on the cached-module paths this process remembers as normalized. */
const MAX_NORMALIZED_MODULE_MEMO_ENTRIES = 4096;
const cryptoRandomUUID = crypto.randomUUID.bind(crypto);

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
      error: error instanceof Error ? error.message : String(error),
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

/** Hard count ceiling for JSX artifacts in one cache directory. */
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
const lazyJsxArtifactExpirations = new Map<string, number>();
let lazyJsxArtifactHeartbeat: ReturnType<typeof setInterval> | undefined;

function retainJsxArtifact(artifactPath: string): void {
  jsxArtifactActiveRefs.set(artifactPath, (jsxArtifactActiveRefs.get(artifactPath) ?? 0) + 1);
}

function releaseJsxArtifact(artifactPath: string): void {
  const count = jsxArtifactActiveRefs.get(artifactPath);
  if (count === undefined) return;
  if (count <= 1) jsxArtifactActiveRefs.delete(artifactPath);
  else jsxArtifactActiveRefs.set(artifactPath, count - 1);
}

function ensureLazyJsxArtifactHeartbeat(): void {
  if (lazyJsxArtifactHeartbeat !== undefined) return;
  lazyJsxArtifactHeartbeat = setInterval(() => {
    const nowMs = Date.now();
    for (const [artifactPath, expiresAtMs] of lazyJsxArtifactExpirations) {
      if (expiresAtMs <= nowMs) {
        lazyJsxArtifactExpirations.delete(artifactPath);
        continue;
      }
      void withJsxArtifactLock(artifactPath, async (assertLeaseOwned) => {
        await assertLeaseOwned();
        await refreshJsxArtifactMtime(artifactPath, 0);
      }).catch(() => undefined);
    }
    if (lazyJsxArtifactExpirations.size === 0 && lazyJsxArtifactHeartbeat !== undefined) {
      clearInterval(lazyJsxArtifactHeartbeat);
      lazyJsxArtifactHeartbeat = undefined;
    }
  }, JSX_CACHE_MTIME_REFRESH_INTERVAL_MS);
  unrefTimer(lazyJsxArtifactHeartbeat);
}

function retainLazyJsxArtifact(artifactPath: string): void {
  lazyJsxArtifactExpirations.set(
    artifactPath,
    Date.now() + LAZY_JSX_ARTIFACT_RETENTION_MS,
  );
  ensureLazyJsxArtifactHeartbeat();
}

function isLazyJsxArtifactRetained(artifactPath: string, nowMs: number = Date.now()): boolean {
  const expiresAtMs = lazyJsxArtifactExpirations.get(artifactPath);
  if (expiresAtMs === undefined) return false;
  if (expiresAtMs > nowMs) return true;
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
): Promise<void> {
  const lastRefreshedMs = Math.max(
    modifiedAtMs,
    mtimeRefreshTimestamps.get(artifactPath) ?? 0,
  );
  if (nowMs - lastRefreshedMs < JSX_CACHE_MTIME_REFRESH_INTERVAL_MS) return;
  const localFs = getLocalFs();
  if (!localFs.utime) return;
  try {
    await localFs.utime(artifactPath, new Date(nowMs), new Date(nowMs));
    recordJsxArtifactMtimeRefresh(artifactPath, nowMs);
  } catch (_) {
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
    retainJsxArtifact(artifactPath);
  }
  if (artifactPaths.length === 0) return () => {};

  // A module may import the same artifact under several specifiers; one
  // refresh per artifact is what "last use" needs, so the duplicates stay
  // only in the reference counts, which release symmetrically below.
  const uniqueArtifactPaths = [...new Set(artifactPaths)];
  const refreshAll = async () => {
    await Promise.all(
      uniqueArtifactPaths.map((artifactPath) =>
        withJsxArtifactLock(artifactPath, async (assertLeaseOwned) => {
          await assertLeaseOwned();
          await refreshJsxArtifactMtime(artifactPath, 0);
        })
      ),
    );
  };
  try {
    await refreshAll();
  } catch (error) {
    for (const artifactPath of artifactPaths) releaseJsxArtifact(artifactPath);
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
    for (const artifactPath of lazyArtifactPaths) retainLazyJsxArtifact(artifactPath);
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
const leaseEncoder = new TextEncoder();

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
    observedOwner = await localFs.readTextFile(lockPath);
    const confirmedModifiedAtMs = (await localFs.stat(lockPath)).mtime?.getTime() ?? nowMs;
    if (confirmedModifiedAtMs !== modifiedAtMs) return false;
  } catch (error) {
    return isNotFoundError(error);
  }
  if (nowMs - modifiedAtMs < JSX_ARTIFACT_LEASE_STALE_MS) return false;

  const stalePath = `${lockPath}.stale-${cryptoRandomUUID()}`;
  try {
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
    try {
      await createExclusive(lockPath, leaseEncoder.encode(renamedOwner));
    } catch (error) {
      if (!isAlreadyExistsError(error)) throw error;
    }
    try {
      await localFs.remove(stalePath);
    } catch (_) { /* best effort */ }
    return false;
  }
  try {
    await localFs.remove(stalePath);
  } catch (_) {
    /* best effort: the uniquely renamed stale lease no longer blocks the lock */
  }
  return true;
}

async function withFilesystemLease<T>(
  lockPath: string,
  operation: (assertLeaseOwned: () => Promise<void>) => Promise<T>,
): Promise<T> {
  const localFs = getLocalFs();
  const createExclusive = localFs.createFileBytesExclusive;
  if (!createExclusive) throw new Error("Atomic JSX cache leases are unavailable");

  const leaseOwner = cryptoRandomUUID();
  const leaseBytes = leaseEncoder.encode(leaseOwner);
  let acquired = false;
  for (let attempt = 0; attempt < JSX_ARTIFACT_LEASE_ATTEMPTS; attempt++) {
    try {
      await createExclusive(lockPath, leaseBytes);
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

  const assertLeaseOwned = async (): Promise<void> => {
    try {
      if (await localFs.readTextFile(lockPath) === leaseOwner) return;
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
    try {
      if (await localFs.readTextFile(lockPath) === leaseOwner) {
        await localFs.remove(lockPath);
      }
    } catch (error) {
      if (!isNotFoundError(error)) {
        logger.debug(`${LOG_PREFIX_MDX_LOADER} Failed to release JSX cache lease`, {
          error: error instanceof Error ? error.message : String(error),
        });
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
): Promise<T> {
  const previous = jsxArtifactLocks.get(artifactPath) ?? Promise.resolve();
  const run = previous.then(() => withFilesystemLease(`${artifactPath}.lock`, operation));
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
  try {
    return (await getLocalFs().stat(path)).mtime?.getTime() ?? 0;
  } catch (_) {
    /* expected: a concurrent transform may have removed the variant already */
    return 0;
  }
}

/** Slack a scheduled follow-up adds so the variants it targets have aged out. */
const JSX_CACHE_PRUNE_RETRY_SLACK_MS = 1_000;

/**
 * Bound on the cache directories holding a pending follow-up prune.
 *
 * One runtime process can serve many projects, and an idle-horizon follow-up
 * stays pending for hours, so the pending set is capped like the other memos
 * here. Dropping the oldest pending timer costs only latency: that directory's
 * collection resumes on its next transform, which arms a sweep again.
 */
const MAX_PENDING_JSX_CACHE_PRUNE_DIRECTORIES = 256;

/** At most one pending follow-up prune per cache directory. */
const scheduledJsxCachePrunes = new Map<
  string,
  { timer: ReturnType<typeof setTimeout>; fireAtMs: number }
>();

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
function scheduleJsxCachePruneRetry(esmCacheDir: string, delayMs: number): void {
  const fireAtMs = Date.now() + delayMs;
  const pending = scheduledJsxCachePrunes.get(esmCacheDir);
  if (pending) {
    if (pending.fireAtMs <= fireAtMs) return;
    clearTimeout(pending.timer);
  } else if (scheduledJsxCachePrunes.size >= MAX_PENDING_JSX_CACHE_PRUNE_DIRECTORIES) {
    const oldestDirectory = scheduledJsxCachePrunes.keys().next().value;
    if (oldestDirectory !== undefined) {
      const oldest = scheduledJsxCachePrunes.get(oldestDirectory);
      if (oldest) clearTimeout(oldest.timer);
      scheduledJsxCachePrunes.delete(oldestDirectory);
    }
  }
  const timer = setTimeout(() => {
    scheduledJsxCachePrunes.delete(esmCacheDir);
    collectExcessJsxArtifacts(esmCacheDir, new Map(), Date.now()).catch((error) => {
      logger.debug(`${LOG_PREFIX_MDX_LOADER} Scheduled JSX cache prune failed`, {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, delayMs);
  unrefTimer(timer);
  scheduledJsxCachePrunes.set(esmCacheDir, { timer, fireAtMs });
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
  if (scheduledJsxCachePrunes.has(esmCacheDir)) return;
  scheduleJsxCachePruneRetry(
    esmCacheDir,
    JSX_CACHE_VARIANT_MIN_AGE_MS + JSX_CACHE_PRUNE_RETRY_SLACK_MS,
  );
}

/** Drop every pending follow-up prune (test isolation only). */
function cancelScheduledJsxCachePrunes(): void {
  for (const pending of scheduledJsxCachePrunes.values()) clearTimeout(pending.timer);
  scheduledJsxCachePrunes.clear();
  if (lazyJsxArtifactHeartbeat !== undefined) {
    clearInterval(lazyJsxArtifactHeartbeat);
    lazyJsxArtifactHeartbeat = undefined;
  }
  lazyJsxArtifactExpirations.clear();
}

export class JsxCacheCapacityError extends Error {
  override name = "JsxCacheCapacityError";
}

function isJsxArtifactName(name: string): boolean {
  return name.startsWith(MDX_JSX_CACHE_ROOT_PREFIX) && name.endsWith(".mjs");
}

async function countJsxArtifacts(esmCacheDir: string): Promise<number> {
  let count = 0;
  for await (const entry of getLocalFs().readDir(esmCacheDir)) {
    if (entry.isFile && isJsxArtifactName(entry.name)) count++;
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
    join(esmCacheDir, ".jsx-directory-quota"),
    async (assertLeaseOwned) => {
      await assertLeaseOwned();
      if (await getLocalFs().exists(artifactPath)) {
        await assertLeaseOwned();
        return await operation(assertLeaseOwned);
      }
      if (await countJsxArtifacts(esmCacheDir) >= MAX_JSX_CACHE_ARTIFACTS_PER_DIRECTORY) {
        await assertLeaseOwned();
        await collectExcessJsxArtifacts(esmCacheDir, new Map(), Date.now());
      }
      if (await countJsxArtifacts(esmCacheDir) >= MAX_JSX_CACHE_ARTIFACTS_PER_DIRECTORY) {
        throw new JsxCacheCapacityError("JSX cache artifact quota is exhausted");
      }
      await assertLeaseOwned();
      return await operation(assertLeaseOwned);
    },
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
          error: error instanceof Error ? error.message : String(error),
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
 * roll, so no variant window can ever cover them again.
 */
async function collectExcessJsxArtifacts(
  esmCacheDir: string,
  currentByPrefix: ReadonlyMap<string, string>,
  nowMs: number,
): Promise<void> {
  const localFs = getLocalFs();

  const variantsByPrefix = new Map<string, string[]>();
  const strandedNamespaceArtifacts: string[] = [];
  const allArtifactNames: string[] = [];
  try {
    for await (const entry of localFs.readDir(esmCacheDir)) {
      if (!entry.isFile) continue;
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
      error: error instanceof Error ? error.message : String(error),
    });
    if (!isNotFoundError(error)) {
      scheduleJsxCachePruneRetry(
        esmCacheDir,
        JSX_CACHE_VARIANT_MIN_AGE_MS + JSX_CACHE_PRUNE_RETRY_SLACK_MS,
      );
    }
    return;
  }

  /** Earliest moment a variant this pass left behind becomes collectable. */
  let retryAtMs: number | undefined;
  const noteRetry = (readyAtMs: number) => {
    retryAtMs = retryAtMs === undefined ? readyAtMs : Math.min(retryAtMs, readyAtMs);
  };

  const quotaHandled = new Set<string>();
  let directoryExcess = Math.max(
    0,
    allArtifactNames.length - MAX_JSX_CACHE_ARTIFACTS_PER_DIRECTORY,
  );
  if (directoryExcess > 0) {
    const protectedNames = new Set(currentByPrefix.values());
    const datedArtifacts = await Promise.all(
      allArtifactNames
        .filter((name) => !protectedNames.has(name))
        .map(async (name) => ({
          name,
          modifiedAtMs: await readArtifactModifiedAtMs(join(esmCacheDir, name)),
        })),
    );
    datedArtifacts.sort((left, right) => left.modifiedAtMs - right.modifiedAtMs);
    for (const { name, modifiedAtMs } of datedArtifacts) {
      if (directoryExcess === 0) break;
      const collectableAtMs = modifiedAtMs + JSX_CACHE_VARIANT_MIN_AGE_MS;
      if (collectableAtMs > nowMs) {
        noteRetry(collectableAtMs);
        continue;
      }
      const removal = await removeJsxArtifactUnlessServed(join(esmCacheDir, name), nowMs);
      quotaHandled.add(name);
      if (removal.removed) directoryExcess--;
      else noteRetry(removal.retryAtMs);
    }
  }

  for (const name of strandedNamespaceArtifacts) {
    if (quotaHandled.has(name)) continue;
    const artifactPath = join(esmCacheDir, name);
    // The grace period still applies, and cache hits refresh mtime, so during
    // a rolling deploy a draining process on the previous namespace keeps the
    // artifacts it is still serving visibly fresh to this check.
    const modifiedAtMs = await readArtifactModifiedAtMs(artifactPath);
    if (nowMs - modifiedAtMs < JSX_CACHE_VARIANT_MIN_AGE_MS) {
      noteRetry(modifiedAtMs + JSX_CACHE_VARIANT_MIN_AGE_MS);
      continue;
    }
    const removal = await removeJsxArtifactUnlessServed(artifactPath, nowMs);
    if (!removal.removed) noteRetry(removal.retryAtMs);
  }

  for (const [prefix, variants] of variantsByPrefix) {
    // The artifact just written, when there is one, counts against the window.
    const retained = MAX_JSX_CACHE_VARIANTS_PER_PATH - (currentByPrefix.has(prefix) ? 1 : 0);

    const dated = await Promise.all(
      variants.map(async (name) => ({
        name,
        modifiedAtMs: await readArtifactModifiedAtMs(join(esmCacheDir, name)),
      })),
    );
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
      if (!removal.removed) noteRetry(removal.retryAtMs);
    }
  }

  if (retryAtMs !== undefined) {
    scheduleJsxCachePruneRetry(
      esmCacheDir,
      Math.max(retryAtMs - nowMs, 0) + JSX_CACHE_PRUNE_RETRY_SLACK_MS,
    );
  }
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
  collectExcessJsxArtifacts,
  hasScheduledJsxCachePrune: (esmCacheDir: string): boolean =>
    scheduledJsxCachePrunes.has(esmCacheDir),
  isModuleRemembered: (transformedPath: string): boolean =>
    normalizedModulePaths.has(transformedPath),
  isLazyArtifactRetained: isLazyJsxArtifactRetained,
  JSX_ARTIFACT_LEASE_STALE_MS,
  LAZY_JSX_ARTIFACT_RETENTION_MS,
  jsxArtifactActiveRefCount: (artifactPath: string): number =>
    jsxArtifactActiveRefs.get(artifactPath) ?? 0,
  MAX_NORMALIZED_MODULE_MEMO_ENTRIES,
  MAX_PENDING_JSX_CACHE_PRUNE_DIRECTORIES,
  MAX_SERVED_ARTIFACT_MEMO_ENTRIES,
  normalizedModuleMemoSize: (): number => normalizedModulePaths.size,
  readArtifactModifiedAtMs,
  releaseJsxArtifact,
  rememberNormalizedModule,
  removeJsxArtifactUnlessServed,
  retainJsxArtifact,
  servedArtifactMemoSize: (): number => servedArtifactTimestamps.size,
  wasJsxArtifactRecentlyServed,
};
