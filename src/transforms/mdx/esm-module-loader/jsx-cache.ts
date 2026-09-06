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

import {
  primordialArrayFilter,
  primordialArrayMap,
  primordialArrayPush,
  primordialArraySort,
  primordialArrayValues,
} from "#veryfront/platform/compat/primordials/array.ts";
import { basename, dirname, join, normalize } from "#veryfront/compat/path";
import { isAlreadyExistsError, isNotFoundError } from "#veryfront/platform/compat/fs.ts";
import { unrefTimer } from "#veryfront/platform/compat/process.ts";
import { rendererLogger as logger } from "#veryfront/utils";
import { Semaphore } from "#veryfront/utils/semaphore.ts";
import { parseImports } from "#veryfront/transforms/esm/lexer.ts";
import {
  buildMdxJsxCacheFileNamePrefix,
  MDX_JSX_CACHE_FILE_NAME_PREFIX_LENGTH,
  MDX_JSX_CACHE_NAMESPACE_PREFIX,
  MDX_JSX_CACHE_ROOT_PREFIX,
} from "#veryfront/transforms/mdx/esm-module-loader/cache-format.ts";
import { LOG_PREFIX_MDX_LOADER } from "./constants.ts";
import { getLocalFs } from "./cache/index.ts";
import { rewriteDntImports } from "./module-fetcher/index.ts";
import { MAX_MDX_MODULE_IMPORTS_PER_FILE } from "#veryfront/transforms/mdx/esm-module-loader/module-fetcher/limits.ts";
import { getMdxEsmCacheDir } from "#veryfront/utils/cache-dir.ts";
import { computeHash } from "#veryfront/utils/hash-utils.ts";

/** Bound on the cached-module paths this process remembers as normalized. */
const MAX_NORMALIZED_MODULE_MEMO_ENTRIES = 4096;
const IntrinsicMap = Map;
const stringStartsWith = Function.prototype.call.bind(String.prototype.startsWith);
const stringEndsWith = Function.prototype.call.bind(String.prototype.endsWith);
const stringSlice = Function.prototype.call.bind(String.prototype.slice);
const IntrinsicSet = Set;
const IntrinsicReflectApply = Reflect.apply;
const MapPrototypeClear = Map.prototype.clear;
const MapPrototypeDelete = Map.prototype.delete;
const MapPrototypeForEach = Map.prototype.forEach;
const MapPrototypeGet = Map.prototype.get;
const MapPrototypeHas = Map.prototype.has;
const MapPrototypeSet = Map.prototype.set;
const MapSizeGetter = Object.getOwnPropertyDescriptor(Map.prototype, "size")!.get!;
const SetPrototypeAdd = Set.prototype.add;
const SetPrototypeClear = Set.prototype.clear;
const SetPrototypeDelete = Set.prototype.delete;
const SetPrototypeForEach = Set.prototype.forEach;
const SetPrototypeHas = Set.prototype.has;
const SetSizeGetter = Object.getOwnPropertyDescriptor(Set.prototype, "size")!.get!;
const hostClearInterval = globalThis.clearInterval.bind(globalThis);
const hostClearTimeout = globalThis.clearTimeout.bind(globalThis);
const hostSetInterval = globalThis.setInterval.bind(globalThis);
const hostSetTimeout = globalThis.setTimeout.bind(globalThis);
const cryptoRandomUUID = crypto.randomUUID.bind(crypto);
const IntrinsicJSONParse = JSON.parse;
const IntrinsicJSONStringify = JSON.stringify;
const IntrinsicObjectCreate = Object.create;

function mapClear<K, V>(map: Map<K, V>): void {
  IntrinsicReflectApply(MapPrototypeClear, map, []);
}

function mapDelete<K, V>(map: Map<K, V>, key: K): boolean {
  return IntrinsicReflectApply(MapPrototypeDelete, map, [key]) as boolean;
}

function mapEntries<K, V>(map: ReadonlyMap<K, V>): Array<[K, V]> {
  const entries: Array<[K, V]> = [];
  IntrinsicReflectApply(MapPrototypeForEach, map, [
    (value: V, key: K) => primordialArrayPush(entries, [key, value]),
  ]);
  return entries;
}

function mapGet<K, V>(map: ReadonlyMap<K, V>, key: K): V | undefined {
  return IntrinsicReflectApply(MapPrototypeGet, map, [key]) as V | undefined;
}

function mapHas<K, V>(map: ReadonlyMap<K, V>, key: K): boolean {
  return IntrinsicReflectApply(MapPrototypeHas, map, [key]) as boolean;
}

function mapSet<K, V>(map: Map<K, V>, key: K, value: V): void {
  IntrinsicReflectApply(MapPrototypeSet, map, [key, value]);
}

function mapSize<K, V>(map: ReadonlyMap<K, V>): number {
  return IntrinsicReflectApply(MapSizeGetter, map, []) as number;
}

function firstMapKey<K, V>(map: ReadonlyMap<K, V>): K | undefined {
  let first: K | undefined;
  let found = false;
  IntrinsicReflectApply(MapPrototypeForEach, map, [(_value: V, key: K) => {
    if (found) return;
    first = key;
    found = true;
  }]);
  return first;
}

function mapValues<K, V>(map: ReadonlyMap<K, V>): V[] {
  const values: V[] = [];
  IntrinsicReflectApply(MapPrototypeForEach, map, [
    (value: V) => primordialArrayPush(values, value),
  ]);
  return values;
}

function setAdd<T>(set: Set<T>, value: T): void {
  IntrinsicReflectApply(SetPrototypeAdd, set, [value]);
}

function setFromArray<T>(values: readonly T[]): Set<T> {
  const set = new IntrinsicSet<T>();
  for (let index = 0; index < values.length; index++) setAdd(set, values[index]);
  return set;
}

function uniqueValues<T>(values: readonly T[]): T[] {
  const result: T[] = [];
  IntrinsicReflectApply(SetPrototypeForEach, setFromArray(values), [
    (value: T) => primordialArrayPush(result, value),
  ]);
  return result;
}

function setClear<T>(set: Set<T>): void {
  IntrinsicReflectApply(SetPrototypeClear, set, []);
}

function setDelete<T>(set: Set<T>, value: T): boolean {
  return IntrinsicReflectApply(SetPrototypeDelete, set, [value]) as boolean;
}

function setHas<T>(set: Set<T>, value: T): boolean {
  return IntrinsicReflectApply(SetPrototypeHas, set, [value]) as boolean;
}

function setSize<T>(set: Set<T>): number {
  return IntrinsicReflectApply(SetSizeGetter, set, []) as number;
}

function firstSetValue<T>(set: Set<T>): T | undefined {
  let first: T | undefined;
  let found = false;
  IntrinsicReflectApply(SetPrototypeForEach, set, [(value: T) => {
    if (found) return;
    first = value;
    found = true;
  }]);
  return first;
}

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
const normalizedModulePaths = new IntrinsicSet<string>();

function rememberNormalizedModule(transformedPath: string): void {
  // Delete-before-add keeps the set in recency order, so reaching capacity
  // evicts the path normalized longest ago instead of wiping the whole memo
  // and re-charging every hot page a read and a scan at once.
  setDelete(normalizedModulePaths, transformedPath);
  if (setSize(normalizedModulePaths) >= MAX_NORMALIZED_MODULE_MEMO_ENTRIES) {
    const oldest = firstSetValue(normalizedModulePaths);
    if (oldest !== undefined) setDelete(normalizedModulePaths, oldest);
  }
  setAdd(normalizedModulePaths, transformedPath);
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

  if (setHas(normalizedModulePaths, transformedPath)) {
    // The memo skips the read and the dnt scan, not the existence check: a
    // prune or an invalidation can remove the artifact between the caller's
    // stat and this call, and reporting it usable would hand the rewritten
    // parent a `file://` import for a module that is no longer there.
    if (await fs.exists(transformedPath)) return true;
    setDelete(normalizedModulePaths, transformedPath);
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
const servedArtifactTimestamps = new IntrinsicMap<string, number>();

export function markJsxArtifactServed(
  transformedPath: string,
  servedAtMs: number = Date.now(),
): void {
  // Delete-before-set keeps the map in recency order, so reaching capacity
  // evicts the artifact served longest ago instead of wiping the whole memo
  // and momentarily dropping the protection every in-flight hit relies on.
  mapDelete(servedArtifactTimestamps, transformedPath);
  if (mapSize(servedArtifactTimestamps) >= MAX_SERVED_ARTIFACT_MEMO_ENTRIES) {
    const oldest = firstMapKey(servedArtifactTimestamps);
    if (oldest !== undefined) mapDelete(servedArtifactTimestamps, oldest);
  }
  mapSet(servedArtifactTimestamps, transformedPath, servedAtMs);
}

function wasJsxArtifactRecentlyServed(transformedPath: string, nowMs: number): boolean {
  const servedAtMs = mapGet(servedArtifactTimestamps, transformedPath);
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
const jsxArtifactActiveRefs = new IntrinsicMap<string, number>();
const LAZY_JSX_ARTIFACT_RETENTION_MS = 10 * 60_000;
const LAZY_JSX_ARTIFACT_HEARTBEAT_CONCURRENCY = 8;
const JSX_ARTIFACT_REFRESH_CONCURRENCY = 8;
const SCHEDULED_JSX_CACHE_PRUNE_CONCURRENCY = 8;
const MAX_LAZY_JSX_ARTIFACTS = MAX_SERVED_ARTIFACT_MEMO_ENTRIES;
const lazyJsxArtifactExpirations = new IntrinsicMap<
  string,
  { expiresAtMs: number; reservations: number }
>();
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
  return Promise.all(primordialArrayValues(workers)).then(() => undefined);
}

function retainJsxArtifact(artifactPath: string): void {
  mapSet(
    jsxArtifactActiveRefs,
    artifactPath,
    (mapGet(jsxArtifactActiveRefs, artifactPath) ?? 0) + 1,
  );
}

function releaseJsxArtifact(artifactPath: string): void {
  const count = mapGet(jsxArtifactActiveRefs, artifactPath);
  if (count === undefined) return;
  if (count <= 1) mapDelete(jsxArtifactActiveRefs, artifactPath);
  else mapSet(jsxArtifactActiveRefs, artifactPath, count - 1);
}

function runLazyJsxArtifactHeartbeat(): Promise<void> {
  if (lazyJsxArtifactHeartbeatInFlight) return lazyJsxArtifactHeartbeatInFlight;
  const run = (async () => {
    const nowMs = Date.now();
    const artifactPaths: string[] = [];
    for (const entry of primordialArrayValues(mapEntries(lazyJsxArtifactExpirations))) {
      const artifactPath = entry[0];
      const retention = entry[1];
      if (retention.reservations === 0 && retention.expiresAtMs <= nowMs) {
        mapDelete(lazyJsxArtifactExpirations, artifactPath);
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
    await Promise.all(primordialArrayValues(workers));
  })();
  lazyJsxArtifactHeartbeatInFlight = run.finally(() => {
    lazyJsxArtifactHeartbeatInFlight = undefined;
    if (mapSize(lazyJsxArtifactExpirations) === 0 && lazyJsxArtifactHeartbeat !== undefined) {
      hostClearInterval(lazyJsxArtifactHeartbeat);
      lazyJsxArtifactHeartbeat = undefined;
    }
  });
  return lazyJsxArtifactHeartbeatInFlight;
}

function ensureLazyJsxArtifactHeartbeat(): void {
  if (lazyJsxArtifactHeartbeat !== undefined) return;
  lazyJsxArtifactHeartbeat = hostSetInterval(() => {
    void runLazyJsxArtifactHeartbeat();
  }, JSX_CACHE_MTIME_REFRESH_INTERVAL_MS);
  unrefTimer(lazyJsxArtifactHeartbeat);
}

function reserveLazyJsxArtifacts(paths: readonly string[]): (retain: boolean) => void {
  const unique = uniqueValues(paths);
  const additionalCount = () =>
    primordialArrayFilter(unique, (path) => !mapHas(lazyJsxArtifactExpirations, path)).length;
  if (mapSize(lazyJsxArtifactExpirations) + additionalCount() > MAX_LAZY_JSX_ARTIFACTS) {
    const now = Date.now();
    for (const entry of primordialArrayValues(mapEntries(lazyJsxArtifactExpirations))) {
      const path = entry[0];
      const record = entry[1];
      if (record.reservations === 0 && record.expiresAtMs <= now) {
        mapDelete(lazyJsxArtifactExpirations, path);
      }
    }
  }
  if (mapSize(lazyJsxArtifactExpirations) + additionalCount() > MAX_LAZY_JSX_ARTIFACTS) {
    throw new JsxCacheCapacityError("JSX lazy artifact retention capacity is exhausted");
  }
  const reservations = primordialArrayMap(unique, (path) => {
    const record = mapGet(lazyJsxArtifactExpirations, path) ?? {
      expiresAtMs: 0,
      reservations: 0,
    };
    record.reservations++;
    mapSet(lazyJsxArtifactExpirations, path, record);
    return { path, record };
  });
  if (reservations.length > 0) ensureLazyJsxArtifactHeartbeat();
  let released = false;
  return (retain) => {
    if (released) return;
    released = true;
    const now = Date.now();
    for (const { path, record } of primordialArrayValues(reservations)) {
      if (mapGet(lazyJsxArtifactExpirations, path) !== record) continue;
      record.reservations--;
      if (retain) {
        record.expiresAtMs = Math.max(record.expiresAtMs, now + LAZY_JSX_ARTIFACT_RETENTION_MS);
      }
      if (record.reservations === 0 && record.expiresAtMs <= now) {
        mapDelete(lazyJsxArtifactExpirations, path);
      }
    }
  };
}

function retainLazyJsxArtifact(artifactPath: string): void {
  reserveLazyJsxArtifacts([artifactPath])(true);
}

function isLazyJsxArtifactRetained(artifactPath: string, nowMs: number = Date.now()): boolean {
  const retention = mapGet(lazyJsxArtifactExpirations, artifactPath);
  if (retention === undefined) return false;
  if (retention.reservations > 0 || retention.expiresAtMs > nowMs) return true;
  mapDelete(lazyJsxArtifactExpirations, artifactPath);
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
const mtimeRefreshTimestamps = new IntrinsicMap<string, number>();

function recordJsxArtifactMtimeRefresh(artifactPath: string, refreshedAtMs: number): void {
  mapDelete(mtimeRefreshTimestamps, artifactPath);
  if (mapSize(mtimeRefreshTimestamps) >= MAX_SERVED_ARTIFACT_MEMO_ENTRIES) {
    const oldest = firstMapKey(mtimeRefreshTimestamps);
    if (oldest !== undefined) mapDelete(mtimeRefreshTimestamps, oldest);
  }
  mapSet(mtimeRefreshTimestamps, artifactPath, refreshedAtMs);
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
    mapGet(mtimeRefreshTimestamps, artifactPath) ?? 0,
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
export function resolveOwnedJsxArtifactPath(
  specifier: string | undefined,
  esmCacheDir: string,
): string | undefined {
  if (specifier === undefined || !stringStartsWith(specifier, "file://")) return undefined;
  const artifactPath = stringSlice(specifier, "file://".length);
  const name = basename(artifactPath);
  if (!stringStartsWith(name, MDX_JSX_CACHE_ROOT_PREFIX) || !stringEndsWith(name, ".mjs")) {
    return undefined;
  }
  const root = normalize(esmCacheDir);
  const target = normalize(artifactPath);
  const prefix = stringEndsWith(root, "/") ? root : `${root}/`;
  if (!stringStartsWith(target, prefix)) return undefined;
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
  retainLazy = true,
): Promise<() => void> {
  const artifactPaths: string[] = [];
  const lazyArtifactPaths: string[] = [];
  for (const imported of primordialArrayValues(await parseImports(code))) {
    const artifactPath = resolveOwnedJsxArtifactPath(imported.n, esmCacheDir);
    if (artifactPath === undefined) continue;
    primordialArrayPush(artifactPaths, artifactPath);
    if (retainLazy && imported.d > -1) primordialArrayPush(lazyArtifactPaths, artifactPath);
    // Both static and lazy artifacts stay actively pinned until the parent
    // import settles. Lazy retention starts only at release, when the parent
    // module cache lifetime begins.
  }
  return await retainJsxArtifactPaths(artifactPaths, lazyArtifactPaths, true);
}

/** Pin a host-owned artifact before writing it, keeping its recency fresh after creation. */
export function retainJsxArtifactForWrite(artifactPath: string): Promise<() => void> {
  return retainJsxArtifactPaths([artifactPath], [], false);
}

async function retainJsxArtifactPaths(
  artifactPaths: string[],
  lazyArtifactPaths: string[],
  required: boolean,
): Promise<() => void> {
  if (artifactPaths.length === 0) return () => {};
  const releaseLazyReservation = reserveLazyJsxArtifacts(lazyArtifactPaths);
  for (const artifactPath of primordialArrayValues(artifactPaths)) retainJsxArtifact(artifactPath);

  // A module may import the same artifact under several specifiers; one
  // refresh per artifact is what "last use" needs, so the duplicates stay
  // only in the reference counts, which release symmetrically below.
  const uniqueArtifactPaths = uniqueValues(artifactPaths);
  let refreshInFlight: Promise<void> | undefined;
  const refreshAll = (): Promise<void> => {
    if (refreshInFlight) return refreshInFlight;
    const run = refreshJsxArtifactsBounded(uniqueArtifactPaths, required);
    refreshInFlight = run.finally(() => {
      refreshInFlight = undefined;
    });
    return refreshInFlight;
  };
  try {
    await refreshAll();
  } catch (error) {
    for (const artifactPath of primordialArrayValues(artifactPaths)) {
      releaseJsxArtifact(artifactPath);
    }
    releaseLazyReservation(false);
    throw error;
  }
  const heartbeat = hostSetInterval(
    () => void refreshAll().catch(() => undefined),
    JSX_CACHE_MTIME_REFRESH_INTERVAL_MS,
  );
  unrefTimer(heartbeat);

  let released = false;
  return () => {
    if (released) return;
    released = true;
    hostClearInterval(heartbeat);
    const nowMs = Date.now();
    for (const artifactPath of primordialArrayValues(artifactPaths)) {
      // The import just completed, so the module is as recently used as a
      // fresh cache hit: the served mark bridges the release and any
      // immediately following prune pass.
      markJsxArtifactServed(artifactPath, nowMs);
    }
    for (const artifactPath of primordialArrayValues(artifactPaths)) {
      releaseJsxArtifact(artifactPath);
    }
    releaseLazyReservation(true);
  };
}

/**
 * Per-artifact operation queues, dropped once the last queued operation
 * settles, so the map holds only paths with an operation in flight.
 */
const jsxArtifactLocks = new IntrinsicMap<string, Promise<void>>();
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
  for (const name of primordialArrayValues(names)) {
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
  for (const name of primordialArrayValues(names)) {
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
      await new Promise((resolve) => hostSetTimeout(resolve, JSX_ARTIFACT_LEASE_RETRY_MS));
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
  let releaseTransition = true;
  try {
    try {
      modifiedAtMs = (await localFs.stat(lockPath)).mtime?.getTime() ?? nowMs;
      observedOwner = await localFs.readTextFile(lockPath);
      if (nowMs - modifiedAtMs < JSX_ARTIFACT_LEASE_STALE_MS) return false;
      await localFs.rename(lockPath, stalePath);
      releaseTransition = false;
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
      releaseTransition = true;
      try {
        await localFs.remove(stalePath);
      } catch (_) {
        // Same stranding risk as the removal below, so arm the same sweep.
        scheduleJsxCachePruneRetry(dirname(lockPath), JSX_CACHE_PRUNE_RETRY_SLACK_MS);
      }
      return false;
    }
    releaseTransition = true;
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
    if (transitionOwner !== undefined && releaseTransition) {
      await removeFilesystemLeaseTransitionIfOwned(lockPath, transitionOwner);
    } else if (!releaseTransition) {
      // An unreadable or unrestored tombstone may belong to a displaced fresh
      // owner. Preserve the fence until abandoned-lease recovery can run.
      scheduleJsxCachePruneRetry(dirname(lockPath), JSX_CACHE_PRUNE_RETRY_SLACK_MS);
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
      await new Promise((resolve) => hostSetTimeout(resolve, JSX_ARTIFACT_LEASE_RETRY_MS));
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
          await new Promise((resolve) => hostSetTimeout(resolve, JSX_ARTIFACT_LEASE_RETRY_MS));
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
      await new Promise((resolve) => hostSetTimeout(resolve, JSX_ARTIFACT_LEASE_RETRY_MS));
    }
  }
  if (!acquired) throw new Error("Timed out waiting for a JSX cache lease");

  const heartbeat = localFs.utime
    ? hostSetInterval(() => {
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
    if (heartbeat !== undefined) hostClearInterval(heartbeat);
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
  const previous = mapGet(jsxArtifactLocks, artifactPath) ?? Promise.resolve();
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
  mapSet(jsxArtifactLocks, artifactPath, settled);
  void settled.then(() => {
    if (mapGet(jsxArtifactLocks, artifactPath) === settled) {
      mapDelete(jsxArtifactLocks, artifactPath);
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
  esmCacheDir: string;
  timer: ReturnType<typeof setTimeout> | undefined;
  fireAtMs: number;
  requestDirectory: string;
  persistedGeneration?: string;
}

interface QueuedJsxCachePrune {
  esmCacheDir: string;
  fireAtMs: number;
  requestDirectory: string;
  persistedGeneration?: string;
}

/** At most one pending follow-up prune per cache directory. */
const scheduledJsxCachePrunes = new IntrinsicMap<string, ScheduledJsxCachePrune>();
const queuedJsxCachePrunes = new IntrinsicMap<string, QueuedJsxCachePrune>();
const pendingJsxCachePersistence = new IntrinsicMap<
  string,
  {
    esmCacheDir: string;
    fireAtMs: number;
    requestDirectory: string;
    persistedGeneration?: string;
  }
>();
let jsxCachePersistencePump: Promise<void> | undefined;
let jsxCachePersistenceRetry: ReturnType<typeof setTimeout> | undefined;
const inFlightJsxCachePrunes = new IntrinsicSet<string>();
let persistedJsxCachePrunePromotion: Promise<void> | undefined;
let persistedJsxCachePrunePromotionRetry: ReturnType<typeof setTimeout> | undefined;
const pendingJsxCachePrunePromotionDirectories = new IntrinsicSet<string>();
let activeJsxCachePrunePromotionDirectory: string | undefined;
let activeJsxCachePrunePromotionRequestedAgain = false;

function getPersistedJsxCachePruneRequestDirectory(): string {
  return join(
    getMdxEsmCacheDir(),
    JSX_CACHE_PRUNE_REQUEST_DIRECTORY,
  );
}

function getJsxCachePruneKey(esmCacheDir: string, requestDirectory: string): string {
  return `${requestDirectory}\0${esmCacheDir}`;
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
  requestDirectory = getPersistedJsxCachePruneRequestDirectory(),
): Promise<void> {
  const path = await getPersistedJsxCachePruneRequestPath(esmCacheDir, requestDirectory);
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

async function promotePersistedJsxCachePruneRequest(
  requestDirectory = getPersistedJsxCachePruneRequestDirectory(),
): Promise<void> {
  const queuedCandidates = primordialArraySort(
    mapEntries(queuedJsxCachePrunes),
    (left, right) => left[1].fireAtMs - right[1].fireAtMs,
  );
  const persistedCandidates: PersistedJsxCachePruneRequest[] = [];
  let requestTombstoneRetryAtMs: number | undefined;
  const noteRequestMaintenanceRetry = (readyAtMs: number) => {
    requestTombstoneRetryAtMs = requestTombstoneRetryAtMs === undefined
      ? readyAtMs
      : Math.min(requestTombstoneRetryAtMs, readyAtMs);
  };
  const retainPersistedCandidate = (request: PersistedJsxCachePruneRequest): void => {
    let index = 0;
    while (
      index < persistedCandidates.length && persistedCandidates[index]!.fireAtMs <= request.fireAtMs
    ) index++;
    for (
      let move = Math.min(persistedCandidates.length, MAX_PENDING_JSX_CACHE_PRUNE_DIRECTORIES - 1);
      move > index;
      move--
    ) {
      persistedCandidates[move] = persistedCandidates[move - 1]!;
    }
    if (index < MAX_PENDING_JSX_CACHE_PRUNE_DIRECTORIES) persistedCandidates[index] = request;
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
      const pruneKey = getJsxCachePruneKey(esmCacheDir, requestDirectory);
      if (
        mapHas(scheduledJsxCachePrunes, pruneKey) ||
        mapHas(queuedJsxCachePrunes, pruneKey) ||
        setHas(inFlightJsxCachePrunes, pruneKey)
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
  if (mapSize(scheduledJsxCachePrunes) >= MAX_PENDING_JSX_CACHE_PRUNE_DIRECTORIES) {
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
        requestDirectory,
      );
    } else if (queued !== undefined) {
      queuedIndex++;
      mapDelete(queuedJsxCachePrunes, queued[0]);
      scheduleJsxCachePruneRetry(
        queued[1].esmCacheDir,
        Math.max(queued[1].fireAtMs - Date.now(), 0),
        queued[1].persistedGeneration,
        queued[1].requestDirectory,
      );
    }
  }
  while (mapSize(scheduledJsxCachePrunes) < MAX_PENDING_JSX_CACHE_PRUNE_DIRECTORIES) {
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
        requestDirectory,
      );
      continue;
    }
    if (queued !== undefined) {
      queuedIndex++;
      mapDelete(queuedJsxCachePrunes, queued[0]);
      scheduleJsxCachePruneRetry(
        queued[1].esmCacheDir,
        Math.max(queued[1].fireAtMs - Date.now(), 0),
        queued[1].persistedGeneration,
        queued[1].requestDirectory,
      );
    }
  }
  if (requestTombstoneRetryAtMs !== undefined) {
    // Request cleanup has its own eventual slot, but must not take the only
    // slot a persisted project request with an earlier deadline just freed.
    scheduleJsxCachePruneRetry(
      requestDirectory,
      Math.max(requestTombstoneRetryAtMs - Date.now(), 0) + JSX_CACHE_PRUNE_RETRY_SLACK_MS,
      undefined,
      requestDirectory,
    );
  }
}

function pumpPersistedJsxCachePrunePromotions(): void {
  if (
    persistedJsxCachePrunePromotion !== undefined ||
    persistedJsxCachePrunePromotionRetry !== undefined
  ) return;
  const requestDirectory = firstSetValue(pendingJsxCachePrunePromotionDirectories);
  if (requestDirectory === undefined) return;
  setDelete(pendingJsxCachePrunePromotionDirectories, requestDirectory);
  activeJsxCachePrunePromotionDirectory = requestDirectory;
  activeJsxCachePrunePromotionRequestedAgain = false;
  const promotion = promotePersistedJsxCachePruneRequest(requestDirectory);
  persistedJsxCachePrunePromotion = promotion;
  void promotion.then(
    () => {
      if (activeJsxCachePrunePromotionRequestedAgain) {
        setAdd(pendingJsxCachePrunePromotionDirectories, requestDirectory);
      }
      activeJsxCachePrunePromotionDirectory = undefined;
      activeJsxCachePrunePromotionRequestedAgain = false;
      persistedJsxCachePrunePromotion = undefined;
      pumpPersistedJsxCachePrunePromotions();
    },
    () => {
      setAdd(pendingJsxCachePrunePromotionDirectories, requestDirectory);
      activeJsxCachePrunePromotionDirectory = undefined;
      activeJsxCachePrunePromotionRequestedAgain = false;
      persistedJsxCachePrunePromotion = undefined;
      persistedJsxCachePrunePromotionRetry = hostSetTimeout(() => {
        persistedJsxCachePrunePromotionRetry = undefined;
        pumpPersistedJsxCachePrunePromotions();
      }, JSX_CACHE_PRUNE_RETRY_SLACK_MS);
      unrefTimer(persistedJsxCachePrunePromotionRetry);
    },
  );
}

function requestPersistedJsxCachePrunePromotion(
  requestDirectory = getPersistedJsxCachePruneRequestDirectory(),
): boolean {
  if (activeJsxCachePrunePromotionDirectory === requestDirectory) {
    activeJsxCachePrunePromotionRequestedAgain = true;
    return true;
  }
  if (setHas(pendingJsxCachePrunePromotionDirectories, requestDirectory)) return true;
  const retainedRoots = setSize(pendingJsxCachePrunePromotionDirectories) +
    (activeJsxCachePrunePromotionDirectory === undefined ? 0 : 1);
  if (retainedRoots >= MAX_PENDING_JSX_CACHE_PRUNE_DIRECTORIES) return false;
  setAdd(pendingJsxCachePrunePromotionDirectories, requestDirectory);
  pumpPersistedJsxCachePrunePromotions();
  return true;
}

function pumpJsxCachePersistence(): void {
  if (jsxCachePersistencePump !== undefined || jsxCachePersistenceRetry !== undefined) return;
  const pump = (async () => {
    for (const entry of primordialArrayValues(mapEntries(pendingJsxCachePersistence))) {
      const pruneKey = entry[0];
      const request = entry[1];
      if (mapGet(pendingJsxCachePersistence, pruneKey) !== request) continue;
      const generation = request.persistedGeneration ??
        await persistJsxCachePruneRequest(
          request.esmCacheDir,
          request.fireAtMs,
          request.requestDirectory,
        );
      if (generation !== undefined) request.persistedGeneration = generation;
      if (
        generation !== undefined &&
        mapGet(pendingJsxCachePersistence, pruneKey) === request &&
        requestPersistedJsxCachePrunePromotion(request.requestDirectory)
      ) {
        mapDelete(pendingJsxCachePersistence, pruneKey);
      }
    }
  })();
  jsxCachePersistencePump = pump;
  void pump.finally(() => {
    jsxCachePersistencePump = undefined;
    if (mapSize(pendingJsxCachePersistence) === 0) return;
    jsxCachePersistenceRetry = hostSetTimeout(() => {
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
  requestDirectory = getPersistedJsxCachePruneRequestDirectory(),
): void {
  const pruneKey = getJsxCachePruneKey(esmCacheDir, requestDirectory);
  const queued = mapGet(queuedJsxCachePrunes, pruneKey);
  if (queued !== undefined) {
    if (fireAtMs < queued.fireAtMs || queued.persistedGeneration === undefined) {
      mapSet(queuedJsxCachePrunes, pruneKey, {
        esmCacheDir,
        fireAtMs: Math.min(fireAtMs, queued.fireAtMs),
        requestDirectory,
        persistedGeneration: queued.persistedGeneration ?? persistedGeneration,
      });
    }
    return;
  }
  if (mapSize(queuedJsxCachePrunes) >= MAX_PENDING_JSX_CACHE_PRUNE_DIRECTORIES) {
    const pending = mapGet(pendingJsxCachePersistence, pruneKey);
    if (
      pending === undefined &&
      mapSize(pendingJsxCachePersistence) >= MAX_PENDING_JSX_CACHE_PRUNE_DIRECTORIES
    ) {
      throw new JsxCacheCapacityError("JSX cache maintenance backlog is exhausted");
    }
    // Omitting the prior durable generation forces every new obligation to
    // renew it, so an older in-flight sweep cannot retire work queued behind it.
    mapSet(pendingJsxCachePersistence, pruneKey, {
      esmCacheDir,
      fireAtMs: Math.min(fireAtMs, pending?.fireAtMs ?? fireAtMs),
      requestDirectory,
    });
    pumpJsxCachePersistence();
    return;
  }
  mapSet(queuedJsxCachePrunes, pruneKey, {
    esmCacheDir,
    fireAtMs,
    requestDirectory,
    persistedGeneration,
  });
}

async function revisitJsxCacheDirectory(
  esmCacheDir: string,
  requestDirectory: string,
): Promise<void> {
  try {
    await scheduledJsxCachePruneSemaphore.acquire(() =>
      collectExcessJsxArtifacts(
        esmCacheDir,
        new IntrinsicMap(),
        Date.now(),
        0,
        requestDirectory,
      ).then(() => undefined)
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
      undefined,
      requestDirectory,
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
  requestDirectory = getPersistedJsxCachePruneRequestDirectory(),
): void {
  const pruneKey = getJsxCachePruneKey(esmCacheDir, requestDirectory);
  const fireAtMs = Date.now() + delayMs;
  const pending = mapGet(scheduledJsxCachePrunes, pruneKey);
  if (pending) {
    if (pending.timer !== undefined && pending.fireAtMs <= fireAtMs) return;
    if (pending.timer !== undefined) hostClearTimeout(pending.timer);
  } else if (mapSize(scheduledJsxCachePrunes) >= MAX_PENDING_JSX_CACHE_PRUNE_DIRECTORIES) {
    let latest: [string, ScheduledJsxCachePrune] | undefined;
    for (const candidate of primordialArrayValues(mapEntries(scheduledJsxCachePrunes))) {
      if (
        candidate[1].timer !== undefined && candidate[1].fireAtMs > fireAtMs &&
        (latest === undefined || candidate[1].fireAtMs > latest[1].fireAtMs)
      ) latest = candidate;
    }
    if (latest === undefined) {
      queueJsxCachePrune(esmCacheDir, fireAtMs, persistedGeneration, requestDirectory);
      return;
    }
    queueJsxCachePrune(
      latest[1].esmCacheDir,
      latest[1].fireAtMs,
      latest[1].persistedGeneration,
      latest[1].requestDirectory,
    );
    hostClearTimeout(latest[1].timer!);
    mapDelete(scheduledJsxCachePrunes, latest[0]);
  }
  const timer = hostSetTimeout(() => {
    const fired = mapGet(scheduledJsxCachePrunes, pruneKey);
    if (fired?.timer !== timer) return;
    // Keep the map entry as this pass's reserved timer slot. A follow-up that
    // the pass schedules can then replace it even when every other slot is
    // occupied, without overflowing to persistence and racing completion.
    fired.timer = undefined;
    void (async () => {
      setAdd(inFlightJsxCachePrunes, pruneKey);
      try {
        await revisitJsxCacheDirectory(esmCacheDir, requestDirectory);
        const followUp = mapGet(scheduledJsxCachePrunes, pruneKey);
        if (
          followUp?.timer === undefined &&
          !mapHas(queuedJsxCachePrunes, pruneKey) &&
          fired.persistedGeneration !== undefined
        ) {
          await retirePersistedJsxCachePruneRequest(
            esmCacheDir,
            fired.persistedGeneration,
            requestDirectory,
          );
        }
      } finally {
        setDelete(inFlightJsxCachePrunes, pruneKey);
        if (mapGet(scheduledJsxCachePrunes, pruneKey)?.timer === undefined) {
          mapDelete(scheduledJsxCachePrunes, pruneKey);
        }
        requestPersistedJsxCachePrunePromotion(requestDirectory);
      }
    })();
  }, delayMs);
  unrefTimer(timer);
  mapSet(scheduledJsxCachePrunes, pruneKey, {
    esmCacheDir,
    timer,
    fireAtMs,
    requestDirectory,
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
  const requestDirectory = getPersistedJsxCachePruneRequestDirectory();
  const pruneKey = getJsxCachePruneKey(esmCacheDir, requestDirectory);
  if (mapHas(scheduledJsxCachePrunes, pruneKey) || mapHas(queuedJsxCachePrunes, pruneKey)) return;
  scheduleJsxCachePruneRetry(
    esmCacheDir,
    JSX_CACHE_VARIANT_MIN_AGE_MS + JSX_CACHE_PRUNE_RETRY_SLACK_MS,
    undefined,
    requestDirectory,
  );
  requestPersistedJsxCachePrunePromotion(requestDirectory);
}

/** Drop every pending follow-up prune (test isolation only). */
function cancelScheduledJsxCachePrunes(): void {
  for (const pending of primordialArrayValues(mapValues(scheduledJsxCachePrunes))) {
    if (pending.timer !== undefined) hostClearTimeout(pending.timer);
  }
  mapClear(scheduledJsxCachePrunes);
  mapClear(queuedJsxCachePrunes);
  mapClear(pendingJsxCachePersistence);
  setClear(pendingJsxCachePrunePromotionDirectories);
  activeJsxCachePrunePromotionRequestedAgain = false;
  if (persistedJsxCachePrunePromotionRetry !== undefined) {
    hostClearTimeout(persistedJsxCachePrunePromotionRetry);
    persistedJsxCachePrunePromotionRetry = undefined;
  }
  if (jsxCachePersistenceRetry !== undefined) {
    hostClearTimeout(jsxCachePersistenceRetry);
    jsxCachePersistenceRetry = undefined;
  }
  if (lazyJsxArtifactHeartbeat !== undefined) {
    hostClearInterval(lazyJsxArtifactHeartbeat);
    lazyJsxArtifactHeartbeat = undefined;
  }
  mapClear(lazyJsxArtifactExpirations);
}

async function waitForJsxCacheMaintenanceForTests(): Promise<void> {
  while (
    jsxCachePersistencePump !== undefined || persistedJsxCachePrunePromotion !== undefined
  ) {
    await Promise.allSettled(
      primordialArrayValues([jsxCachePersistencePump, persistedJsxCachePrunePromotion]),
    );
  }
}

async function hasPersistedJsxCachePrune(esmCacheDir: string): Promise<boolean> {
  const requestDirectory = getPersistedJsxCachePruneRequestDirectory();
  try {
    for await (const entry of getLocalFs().readDir(requestDirectory)) {
      if (!entry.isFile || !entry.name.startsWith(JSX_CACHE_PRUNE_REQUEST_PREFIX)) continue;
      try {
        const request = IntrinsicJSONParse(
          await getLocalFs().readTextFile(
            join(requestDirectory, entry.name),
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
          new IntrinsicMap(),
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
      mapHas(jsxArtifactActiveRefs, artifactPath) ||
      isLazyJsxArtifactRetained(artifactPath, checkedAtMs)
    ) {
      // Release time is the parent import settling, which has no schedule of
      // its own; poll again one grace period out.
      return { removed: false, retryAtMs: checkedAtMs + JSX_CACHE_VARIANT_MIN_AGE_MS };
    }
    const servedAtMs = mapGet(servedArtifactTimestamps, artifactPath);
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
    mapDelete(mtimeRefreshTimestamps, artifactPath);
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
  if (mapSize(writtenArtifacts) === 0) return;

  const currentByPrefix = new IntrinsicMap<string, string>();
  for (const entry of primordialArrayValues(mapEntries(writtenArtifacts))) {
    const filePath = entry[0];
    const currentFileName = entry[1];
    mapSet(currentByPrefix, buildMdxJsxCacheFileNamePrefix(filePath), currentFileName);
  }
  await collectExcessJsxArtifacts(esmCacheDir, currentByPrefix, nowMs);
}

/**
 * One prune pass over `esmCacheDir`. `currentByPrefix` protects the artifacts
 * the caller just wrote; a scheduled follow-up passes none and relies on the
 * grace period and idle floor alone. Beyond the per-path variant window, the
 * pass retires any variant idle past {@link JSX_CACHE_VARIANT_MAX_IDLE_AGE_MS}
 * (the directory-wide backstop that keeps retired source paths from leaking
 * one artifact each). Prior namespaces remain until an operator verifies
 * that their older readers have drained. The pass also sweeps the
 * lease tombstones and transition fences a recovery could not remove itself,
 * which nothing else in the directory accounts for.
 */
async function readJsxArtifactDates(
  directory: string,
  names: readonly string[],
): Promise<Array<{ name: string; modifiedAtMs: number }>> {
  const dated: Array<{ name: string; modifiedAtMs: number }> = [];
  let next = 0;
  const workers: Array<Promise<void>> = [];
  const workerCount = Math.min(JSX_ARTIFACT_REFRESH_CONCURRENCY, names.length);
  for (let workerIndex = 0; workerIndex < workerCount; workerIndex++) {
    workers[workerIndex] = (async () => {
      while (next < names.length) {
        const index = next++;
        const name = names[index]!;
        const modifiedAtMs = await readArtifactModifiedAtMs(join(directory, name));
        dated[index] = { name, modifiedAtMs };
      }
    })();
  }
  await Promise.all(primordialArrayValues(workers));
  return dated;
}

async function collectExcessJsxArtifacts(
  esmCacheDir: string,
  currentByPrefix: ReadonlyMap<string, string>,
  nowMs: number,
  reservedSlots = 0,
  requestDirectory = getPersistedJsxCachePruneRequestDirectory(),
): Promise<number | undefined> {
  const localFs = getLocalFs();

  const variantsByPrefix = new IntrinsicMap<string, string[]>();
  const leaseTombstones: string[] = [];
  const leaseTransitions: string[] = [];
  const possibleOrphanLeaseArtifacts: Array<{ artifactName: string; lockName: string }> = [];
  const allArtifactNames: string[] = [];
  try {
    for await (const entry of localFs.readDir(esmCacheDir)) {
      if (!entry.isFile) continue;
      if (isJsxLeaseTombstoneName(entry.name)) {
        primordialArrayPush(leaseTombstones, entry.name);
        continue;
      }
      if (isJsxLeaseTransitionName(entry.name)) {
        primordialArrayPush(leaseTransitions, entry.name);
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
      if (isJsxArtifactName(entry.name)) primordialArrayPush(allArtifactNames, entry.name);
      if (!entry.name.startsWith(MDX_JSX_CACHE_NAMESPACE_PREFIX)) {
        continue;
      }
      if (entry.name.length <= MDX_JSX_CACHE_FILE_NAME_PREFIX_LENGTH) continue;

      const prefix = entry.name.slice(0, MDX_JSX_CACHE_FILE_NAME_PREFIX_LENGTH);
      if (entry.name === mapGet(currentByPrefix, prefix)) continue;

      const variants = mapGet(variantsByPrefix, prefix);
      if (variants) primordialArrayPush(variants, entry.name);
      else mapSet(variantsByPrefix, prefix, [entry.name]);
    }
  } catch (error) {
    logger.debug(`${LOG_PREFIX_MDX_LOADER} Failed to scan JSX cache artifacts for pruning`, {
      error: cacheFilesystemErrorCode(error),
    });
    if (!isNotFoundError(error)) {
      scheduleJsxCachePruneRetry(
        esmCacheDir,
        JSX_CACHE_VARIANT_MIN_AGE_MS + JSX_CACHE_PRUNE_RETRY_SLACK_MS,
        undefined,
        requestDirectory,
      );
    }
    return undefined;
  }

  let remainingCurrentNamespaceArtifacts = primordialArrayFilter(
    allArtifactNames,
    (name) => name.startsWith(MDX_JSX_CACHE_NAMESPACE_PREFIX),
  ).length;
  const artifactNames = setFromArray(allArtifactNames);
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
  if (mapSize(currentByPrefix) > 0) {
    noteRetry(nowMs + JSX_CACHE_VARIANT_MAX_IDLE_AGE_MS);
  }

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

  for (const { artifactName, lockName } of primordialArrayValues(possibleOrphanLeaseArtifacts)) {
    if (setHas(artifactNames, artifactName)) continue;
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

  const quotaHandled = new IntrinsicSet<string>();
  let directoryExcess = Math.max(
    0,
    primordialArrayFilter(
      allArtifactNames,
      (name) => name.startsWith(MDX_JSX_CACHE_NAMESPACE_PREFIX),
    ).length +
      reservedSlots -
      MAX_JSX_CACHE_ARTIFACTS_PER_DIRECTORY,
  );
  if (directoryExcess > 0) {
    const protectedNames = setFromArray(mapValues(currentByPrefix));
    const datedArtifacts = await readJsxArtifactDates(
      esmCacheDir,
      primordialArrayFilter(
        allArtifactNames,
        (name) => name.startsWith(MDX_JSX_CACHE_NAMESPACE_PREFIX) && !setHas(protectedNames, name),
      ),
    );
    primordialArraySort(datedArtifacts, (left, right) => left.modifiedAtMs - right.modifiedAtMs);
    for (const { name, modifiedAtMs } of primordialArrayValues(datedArtifacts)) {
      if (directoryExcess === 0) break;
      const collectableAtMs = modifiedAtMs + JSX_CACHE_VARIANT_MIN_AGE_MS;
      if (collectableAtMs > nowMs) {
        noteRetry(collectableAtMs);
        continue;
      }
      const removal = await removeJsxArtifactUnlessServed(join(esmCacheDir, name), nowMs);
      setAdd(quotaHandled, name);
      if (removal.removed) {
        directoryExcess--;
        noteArtifactRemoval(name, removal);
      } else noteRetry(removal.retryAtMs);
    }
  }

  // Prior namespaces have no reliable reader heartbeat. Only operators can
  // retire them after verifying that all older runtimes have drained.

  for (const entry of primordialArrayValues(mapEntries(variantsByPrefix))) {
    const prefix = entry[0];
    const variants = entry[1];
    // The artifact just written, when there is one, counts against the window.
    const retained = MAX_JSX_CACHE_VARIANTS_PER_PATH -
      (mapHas(currentByPrefix, prefix) ? 1 : 0);

    const dated = await readJsxArtifactDates(esmCacheDir, variants);
    primordialArraySort(dated, (left, right) => right.modifiedAtMs - left.modifiedAtMs);

    for (let index = 0; index < dated.length; index++) {
      const { name, modifiedAtMs } = dated[index]!;
      if (setHas(quotaHandled, name)) continue;
      const artifactPath = join(esmCacheDir, name);
      const servedAtMs = mapGet(servedArtifactTimestamps, artifactPath) ?? 0;
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
      undefined,
      requestDirectory,
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
  recoverStaleFilesystemLease,
  cancelScheduledJsxCachePrunes,
  clearPersistedJsxCachePruneRequestsForTests,
  collectExcessJsxArtifacts,
  getPersistedJsxCachePruneRequestPath,
  hasScheduledJsxCachePrune: (esmCacheDir: string): boolean => {
    const requestDirectory = getPersistedJsxCachePruneRequestDirectory();
    const pruneKey = getJsxCachePruneKey(esmCacheDir, requestDirectory);
    return mapHas(scheduledJsxCachePrunes, pruneKey) || mapHas(queuedJsxCachePrunes, pruneKey);
  },
  hasPersistedJsxCachePrune,
  isModuleRemembered: (transformedPath: string): boolean =>
    setHas(normalizedModulePaths, transformedPath),
  isLazyArtifactRetained: isLazyJsxArtifactRetained,
  JSX_ARTIFACT_LEASE_STALE_MS,
  JSX_ARTIFACT_REFRESH_CONCURRENCY,
  LAZY_JSX_ARTIFACT_RETENTION_MS,
  LAZY_JSX_ARTIFACT_HEARTBEAT_CONCURRENCY,
  jsxArtifactActiveRefCount: (artifactPath: string): number =>
    mapGet(jsxArtifactActiveRefs, artifactPath) ?? 0,
  MAX_NORMALIZED_MODULE_MEMO_ENTRIES,
  MAX_PENDING_JSX_CACHE_PRUNE_DIRECTORIES,
  MAX_SERVED_ARTIFACT_MEMO_ENTRIES,
  normalizedModuleMemoSize: (): number => setSize(normalizedModulePaths),
  persistJsxCachePruneRequest,
  promotePersistedJsxCachePruneRequest,
  queueJsxCachePrune,
  queuedJsxCachePruneCount: (): number => mapSize(queuedJsxCachePrunes),
  readArtifactModifiedAtMs,
  retirePersistedJsxCachePruneRequest,
  retainLazyJsxArtifact,
  releaseJsxArtifact,
  rememberNormalizedModule,
  removeJsxArtifactUnlessServed,
  retainJsxArtifact,
  scheduleJsxCachePruneRetry,
  SCHEDULED_JSX_CACHE_PRUNE_CONCURRENCY,
  scheduledJsxCachePruneCount: (): number => mapSize(scheduledJsxCachePrunes),
  hasActiveScheduledJsxCachePrune: (esmCacheDir: string): boolean => {
    const requestDirectory = getPersistedJsxCachePruneRequestDirectory();
    return mapGet(
      scheduledJsxCachePrunes,
      getJsxCachePruneKey(esmCacheDir, requestDirectory),
    )?.timer !== undefined;
  },
  runLazyJsxArtifactHeartbeat,
  servedArtifactMemoSize: (): number => mapSize(servedArtifactTimestamps),
  withJsxArtifactRefreshSlot,
  waitForJsxCacheMaintenanceForTests,
  wasJsxArtifactRecentlyServed,
};
