import type { VeryfrontConfig } from "#veryfront/config";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { snapshotImportMap } from "#veryfront/transforms/pipeline/cache-identity.ts";
import { computeHash } from "#veryfront/utils/hash-utils.ts";
import type { ImportMapConfig } from "./types.ts";
import { loadImportMap } from "./loader.ts";

export interface PreloadImportMapContext {
  /** On-disk project root selected for this render. */
  projectDir?: string;
  /** Immutable content source selected for this render (release, branch, or environment). */
  contentSourceId?: string;
  /** Config already validated for the authenticated request. */
  config?: VeryfrontConfig;
}

const IMPORT_MAP_CACHE_IDENTITY_NAMESPACE = "veryfront:preloaded-import-map:v2";
const DEFAULT_MAX_IMPORT_MAP_PROJECTS = 512;
const DEFAULT_MAX_IMPORT_MAP_VARIANTS_PER_PROJECT = 16;
const DEFAULT_IMPORT_MAP_TTL_MS = 10 * 60 * 1_000;
const DEFAULT_IMPORT_MAP_LOAD_TIMEOUT_MS = 30_000;
const CAPACITY_ERROR = Symbol("ImportMapPreloader.capacityError");

// Project code can execute in the same realm before a later request reaches
// this cache. Capture every primitive used for identity, admission, and
// settlement so replacing shared built-ins cannot redirect dependency graphs.
const ArrayPrototypePush = Array.prototype.push;
const ArrayPrototypeSort = Array.prototype.sort;
const DateNow = Date.now;
const IntrinsicMap = Map;
const IntrinsicPromise = Promise;
const IntrinsicRangeError = RangeError;
const IntrinsicSet = Set;
const IntrinsicTypeError = TypeError;
const JSONStringify = JSON.stringify;
const MapPrototypeClear = Map.prototype.clear;
const MapPrototypeDelete = Map.prototype.delete;
const MapPrototypeForEach = Map.prototype.forEach;
const MapPrototypeGet = Map.prototype.get;
const MapPrototypeSet = Map.prototype.set;
const MapPrototypeSize = Object.getOwnPropertyDescriptor(Map.prototype, "size")!
  .get!;
const MathMin = Math.min;
const NUMBER_MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;
const NumberIsFinite = Number.isFinite;
const NumberIsSafeInteger = Number.isSafeInteger;
const ObjectDefineProperty = Object.defineProperty;
const ObjectEntries = Object.entries;
const ObjectFreeze = Object.freeze;
const ObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const ObjectPrototypeHasOwnProperty = Object.prototype.hasOwnProperty;
const PromisePrototypeThen = Promise.prototype.then;
const PromiseResolve = Promise.resolve;
const ReflectApply = Reflect.apply;
const SetPrototypeAdd = Set.prototype.add;
const SetPrototypeDelete = Set.prototype.delete;
const SetPrototypeForEach = Set.prototype.forEach;
const SetPrototypeSize = Object.getOwnPropertyDescriptor(Set.prototype, "size")!
  .get!;
const SetTimeout = setTimeout;
const ClearTimeout = clearTimeout;

function hasOwn(object: object, key: PropertyKey): boolean {
  return ReflectApply(ObjectPrototypeHasOwnProperty, object, [key]) as boolean;
}

function arraySort<T>(
  values: T[],
  compare: (left: T, right: T) => number,
): T[] {
  return ReflectApply(ArrayPrototypeSort, values, [compare]) as T[];
}

function arrayPush<T>(values: T[], value: T): void {
  ReflectApply(ArrayPrototypePush, values, [value]);
}

function mapClear<K, V>(map: Map<K, V>): void {
  ReflectApply(MapPrototypeClear, map, []);
}

function mapDelete<K, V>(map: Map<K, V>, key: K): boolean {
  return ReflectApply(MapPrototypeDelete, map, [key]) as boolean;
}

function mapForEach<K, V>(
  map: Map<K, V>,
  callback: (value: V, key: K) => void,
): void {
  ReflectApply(MapPrototypeForEach, map, [callback]);
}

function mapGet<K, V>(map: Map<K, V>, key: K): V | undefined {
  return ReflectApply(MapPrototypeGet, map, [key]) as V | undefined;
}

function mapSet<K, V>(map: Map<K, V>, key: K, value: V): void {
  ReflectApply(MapPrototypeSet, map, [key, value]);
}

function mapSize<K, V>(map: Map<K, V>): number {
  return ReflectApply(MapPrototypeSize, map, []) as number;
}

function promiseThen<T, TResult1 = T, TResult2 = never>(
  promise: Promise<T>,
  onFulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null,
  onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
): Promise<TResult1 | TResult2> {
  return ReflectApply(PromisePrototypeThen, promise, [
    onFulfilled,
    onRejected,
  ]) as Promise<TResult1 | TResult2>;
}

function resolvedPromise(): Promise<void> {
  return ReflectApply(PromiseResolve, IntrinsicPromise, []) as Promise<void>;
}

function setAdd<T>(set: Set<T>, value: T): void {
  ReflectApply(SetPrototypeAdd, set, [value]);
}

function setDelete<T>(set: Set<T>, value: T): boolean {
  return ReflectApply(SetPrototypeDelete, set, [value]) as boolean;
}

function setForEach<T>(set: Set<T>, callback: (value: T) => void): void {
  ReflectApply(SetPrototypeForEach, set, [callback]);
}

function setSize<T>(set: Set<T>): number {
  return ReflectApply(SetPrototypeSize, set, []) as number;
}

interface CachedImportMap {
  readonly promise: Promise<ImportMapConfig>;
  /** Starts when the load settles; in-flight work is never expired mid-flight. */
  expiresAt: number | null;
}

type ProjectImportMapCache = Map<string, CachedImportMap>;

interface ProjectImportMapState {
  readonly variants: ProjectImportMapCache;
  generation: object;
  /** Hashes being computed or retained while their matching load is in flight. */
  readonly identityBuilds: Map<string, Promise<string>>;
}

function createGeneration(): object {
  return ObjectFreeze({});
}

export interface ImportMapPreloaderOptions {
  /** Maximum tenant/project buckets retained by one preloader. */
  maxProjects?: number;
  /** Maximum content-source/config variants retained for one project. */
  maxVariantsPerProject?: number;
  /** Retention lifetime after a successful load. */
  ttlMs?: number;
  /** Maximum time an in-flight loader can pin cache capacity. */
  loadTimeoutMs?: number;
  /** Monotonic-enough clock seam; defaults to Date.now. */
  now?: () => number;
  /** Loader seam for alternate runtimes and deterministic verification. */
  loadImportMap?: typeof loadImportMap;
}

function compareEntries(
  left: readonly [string, string],
  right: readonly [string, string],
): number {
  return left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0;
}

/**
 * Bind cache identity and loader input to one immutable import-map snapshot
 * before the first async boundary. Validated config objects are caller-owned
 * and need not remain unchanged while SHA-256 is being computed.
 */
function snapshotPreloadContext(
  context?: PreloadImportMapContext,
): PreloadImportMapContext | undefined {
  if (!context) return undefined;
  const contentSourceId = readOptionalOwnDataProperty(
    context,
    "contentSourceId",
    "Preload import-map context",
  );
  if (contentSourceId !== undefined && typeof contentSourceId !== "string") {
    throw new IntrinsicTypeError("Preload import-map contentSourceId must be a string");
  }
  const projectDir = readOptionalOwnDataProperty(
    context,
    "projectDir",
    "Preload import-map context",
  );
  if (projectDir !== undefined && typeof projectDir !== "string") {
    throw new IntrinsicTypeError("Preload import-map projectDir must be a string");
  }
  const config = readOptionalOwnDataProperty(
    context,
    "config",
    "Preload import-map context",
  ) as VeryfrontConfig | undefined;
  if (config === undefined) return ObjectFreeze({ projectDir, contentSourceId });
  if (config === null || typeof config !== "object") {
    throw new IntrinsicTypeError("Preload import-map config must be a non-null object");
  }

  const resolve = readOptionalOwnDataProperty(config, "resolve", "Veryfront config");
  const importMap = resolve && typeof resolve === "object"
    ? readOptionalOwnDataProperty(resolve, "importMap", "Veryfront config resolve")
    : undefined;
  const exactConfig = ObjectFreeze({
    resolve: ObjectFreeze({
      importMap: snapshotImportMap(importMap ?? {}),
    }),
  }) as VeryfrontConfig;
  return ObjectFreeze({ projectDir, contentSourceId, config: exactConfig });
}

function buildVariantCanonicalIdentity(
  context?: PreloadImportMapContext,
): string {
  const importMap = context?.config?.resolve?.importMap;
  let canonical = `${IMPORT_MAP_CACHE_IDENTITY_NAMESPACE}\0project:${
    JSONStringify(context?.projectDir ?? null)
  }\0source:${JSONStringify(context?.contentSourceId ?? null)}\0`;
  if (!context?.config) return `${canonical}ambient`;

  canonical += "validated";
  const imports = arraySort(
    ObjectEntries(importMap?.imports ?? {}),
    compareEntries,
  );
  for (let index = 0; index < imports.length; index++) {
    const entry = imports[index]!;
    // JSON stringification is applied only to primitives. That keeps escaping
    // canonical without exposing identity objects to inherited toJSON hooks.
    canonical += `\0import:${JSONStringify(entry[0])}:${JSONStringify(entry[1])}`;
  }

  const scopes = arraySort(
    ObjectEntries(importMap?.scopes ?? {}),
    (left, right) => left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0,
  );
  for (let scopeIndex = 0; scopeIndex < scopes.length; scopeIndex++) {
    const scopeEntry = scopes[scopeIndex]!;
    canonical += `\0scope:${JSONStringify(scopeEntry[0])}`;
    const mappings = arraySort(ObjectEntries(scopeEntry[1]), compareEntries);
    for (let mappingIndex = 0; mappingIndex < mappings.length; mappingIndex++) {
      const mapping = mappings[mappingIndex]!;
      canonical += `\0mapping:${JSONStringify(mapping[0])}:${JSONStringify(mapping[1])}`;
    }
  }
  return canonical;
}

function racePromises<T>(promises: Array<Promise<T>>): Promise<T> {
  return new IntrinsicPromise<T>((resolve, reject) => {
    for (let index = 0; index < promises.length; index++) {
      promiseThen(promises[index]!, resolve, reject);
    }
  });
}

function readOptionalOwnDataProperty(
  value: object,
  key: PropertyKey,
  label: string,
): unknown {
  const descriptor = ObjectGetOwnPropertyDescriptor(value, key);
  if (!descriptor) return undefined;
  if (!hasOwn(descriptor, "value")) {
    throw new IntrinsicTypeError(`${label} cannot contain accessor properties`);
  }
  return descriptor.value;
}

function readPositiveSafeInteger(
  value: number | undefined,
  fallback: number,
  label: string,
): number {
  const resolved = value ?? fallback;
  if (!NumberIsSafeInteger(resolved) || resolved <= 0) {
    throw new IntrinsicRangeError(`${label} must be a positive safe integer`);
  }
  return resolved;
}

/**
 * Bounded two-level import-map cache.
 *
 * Map insertion order is the LRU order at both levels. Expiry is lazy, avoiding
 * a process-wide timer while still placing a hard ceiling on retained values.
 */
export class ImportMapPreloader {
  private readonly projects = new IntrinsicMap<string, ProjectImportMapState>();
  /** Underlying loader work remains accounted for even after explicit invalidation. */
  private readonly activeLoads = new IntrinsicSet<Promise<ImportMapConfig>>();
  private readonly activeIdentityBuilds = new IntrinsicSet<Promise<string>>();
  private globalGeneration = createGeneration();
  private readonly maxProjects: number;
  private readonly maxVariantsPerProject: number;
  private readonly maxConcurrentLoads: number;
  private readonly ttlMs: number;
  private readonly loadTimeoutMs: number;
  private readonly now: () => number;
  private readonly loader: typeof loadImportMap;

  constructor(options: ImportMapPreloaderOptions = {}) {
    this.maxProjects = readPositiveSafeInteger(
      options.maxProjects,
      DEFAULT_MAX_IMPORT_MAP_PROJECTS,
      "maxProjects",
    );
    this.maxVariantsPerProject = readPositiveSafeInteger(
      options.maxVariantsPerProject,
      DEFAULT_MAX_IMPORT_MAP_VARIANTS_PER_PROJECT,
      "maxVariantsPerProject",
    );
    this.maxConcurrentLoads = MathMin(
      NUMBER_MAX_SAFE_INTEGER,
      this.maxProjects * this.maxVariantsPerProject,
    );
    this.ttlMs = readPositiveSafeInteger(
      options.ttlMs,
      DEFAULT_IMPORT_MAP_TTL_MS,
      "ttlMs",
    );
    this.loadTimeoutMs = readPositiveSafeInteger(
      options.loadTimeoutMs,
      DEFAULT_IMPORT_MAP_LOAD_TIMEOUT_MS,
      "loadTimeoutMs",
    );
    this.now = options.now ?? DateNow;
    this.loader = options.loadImportMap ?? loadImportMap;
  }

  private readNow(): number {
    const now = this.now();
    if (!NumberIsFinite(now)) {
      throw new IntrinsicRangeError("Import-map cache clock must be finite");
    }
    return now;
  }

  private touchProject(cacheKey: string, projectState: ProjectImportMapState): void {
    mapDelete(this.projects, cacheKey);
    mapSet(this.projects, cacheKey, projectState);
  }

  private touchVariant(
    projectCache: ProjectImportMapCache,
    variantKey: string,
    entry: CachedImportMap,
  ): void {
    mapDelete(projectCache, variantKey);
    mapSet(projectCache, variantKey, entry);
  }

  private deleteEntry(
    cacheKey: string,
    projectState: ProjectImportMapState,
    variantKey: string,
    entry: CachedImportMap,
    removeEmptyProject = true,
  ): void {
    const projectCache = projectState.variants;
    if (mapGet(projectCache, variantKey) !== entry) return;
    mapDelete(projectCache, variantKey);
    if (
      removeEmptyProject &&
      mapSize(projectCache) === 0 &&
      mapSize(projectState.identityBuilds) === 0 &&
      mapGet(this.projects, cacheKey) === projectState
    ) {
      mapDelete(this.projects, cacheKey);
    }
  }

  private getEntry(
    cacheKey: string,
    variantKey: string,
    now: number,
    preserveProjectIfEmpty = false,
  ): CachedImportMap | undefined {
    const projectState = mapGet(this.projects, cacheKey);
    const projectCache = projectState?.variants;
    const entry = projectCache ? mapGet(projectCache, variantKey) : undefined;
    if (!projectState || !projectCache || !entry) return undefined;

    if (entry.expiresAt !== null && entry.expiresAt <= now) {
      this.deleteEntry(
        cacheKey,
        projectState,
        variantKey,
        entry,
        !preserveProjectIfEmpty,
      );
      return undefined;
    }

    this.touchVariant(projectCache, variantKey, entry);
    this.touchProject(cacheKey, projectState);
    return entry;
  }

  private capacityError(scope: "projects" | "variants" | "loads"): RangeError {
    const error = new IntrinsicRangeError(
      `Import-map preloader ${scope} capacity is occupied by in-flight loads; retry after a load settles`,
    );
    ObjectDefineProperty(error, CAPACITY_ERROR, {
      configurable: false,
      enumerable: false,
      value: true,
      writable: false,
    });
    return error;
  }

  private isCapacityError(error: unknown): boolean {
    return Boolean(
      error && typeof error === "object" &&
        (error as { [CAPACITY_ERROR]?: boolean })[CAPACITY_ERROR],
    );
  }

  private waitForActiveWork(): Promise<void> {
    const activeWork: Array<Promise<unknown>> = [];
    setForEach(this.activeLoads, (promise) => arrayPush(activeWork, promise));
    setForEach(this.activeIdentityBuilds, (promise) => arrayPush(activeWork, promise));
    if (activeWork.length === 0) throw this.capacityError("loads");
    const raced = racePromises(activeWork);
    return promiseThen(
      raced,
      () => resolvedPromise(),
      () => resolvedPromise(),
    );
  }

  private makeProjectRoom(now: number): void {
    mapForEach(this.projects, (projectState, cacheKey) => {
      const projectCache = projectState.variants;
      mapForEach(projectCache, (entry, variantKey) => {
        if (entry.expiresAt !== null && entry.expiresAt <= now) {
          mapDelete(projectCache, variantKey);
        }
      });
      if (
        mapSize(projectCache) === 0 &&
        mapSize(projectState.identityBuilds) === 0
      ) {
        mapDelete(this.projects, cacheKey);
      }
    });

    while (mapSize(this.projects) >= this.maxProjects) {
      let oldestSettledProject: string | undefined;
      mapForEach(this.projects, (projectState, cacheKey) => {
        if (oldestSettledProject !== undefined) return;
        if (mapSize(projectState.identityBuilds) > 0) return;
        let hasInFlightEntry = false;
        mapForEach(projectState.variants, (entry) => {
          if (entry.expiresAt === null) {
            hasInFlightEntry = true;
          }
        });
        if (!hasInFlightEntry) {
          oldestSettledProject = cacheKey;
        }
      });
      if (oldestSettledProject === undefined) throw this.capacityError("projects");
      mapDelete(this.projects, oldestSettledProject);
    }
  }

  private makeVariantRoom(projectCache: ProjectImportMapCache, now: number): void {
    mapForEach(projectCache, (entry, variantKey) => {
      if (entry.expiresAt !== null && entry.expiresAt <= now) {
        mapDelete(projectCache, variantKey);
      }
    });

    while (mapSize(projectCache) >= this.maxVariantsPerProject) {
      let oldestSettledVariant: string | undefined;
      mapForEach(projectCache, (entry, variantKey) => {
        if (oldestSettledVariant !== undefined) return;
        if (entry.expiresAt !== null) {
          oldestSettledVariant = variantKey;
        }
      });
      if (oldestSettledVariant === undefined) throw this.capacityError("variants");
      mapDelete(projectCache, oldestSettledVariant);
    }
  }

  private trackActiveLoad(promise: Promise<ImportMapConfig>): void {
    setAdd(this.activeLoads, promise);
    promiseThen(
      promise,
      () => {
        setDelete(this.activeLoads, promise);
      },
      () => {
        setDelete(this.activeLoads, promise);
      },
    );
  }

  private hasActiveWorkCapacity(): boolean {
    return setSize(this.activeLoads) + setSize(this.activeIdentityBuilds) <
      this.maxConcurrentLoads;
  }

  private releaseIdentityBuild(
    projectState: ProjectImportMapState,
    canonicalIdentity: string,
    promise: Promise<string>,
  ): void {
    if (mapGet(projectState.identityBuilds, canonicalIdentity) === promise) {
      mapDelete(projectState.identityBuilds, canonicalIdentity);
    }
  }

  private getOrCreateIdentityBuild(
    projectState: ProjectImportMapState,
    canonicalIdentity: string,
  ): Promise<string> {
    const existing = mapGet(projectState.identityBuilds, canonicalIdentity);
    if (existing) return existing;
    if (mapSize(projectState.identityBuilds) >= this.maxVariantsPerProject) {
      throw this.capacityError("variants");
    }
    if (!this.hasActiveWorkCapacity()) throw this.capacityError("loads");

    const promise = computeHash(canonicalIdentity);
    mapSet(projectState.identityBuilds, canonicalIdentity, promise);
    setAdd(this.activeIdentityBuilds, promise);
    // Hash settlement frees global hashing capacity immediately. Keep the
    // resolved per-project identity until its load settles, though, so a later
    // request can reach and join that in-flight entry even when load capacity
    // is otherwise full.
    const releaseActive = (): void => {
      setDelete(this.activeIdentityBuilds, promise);
    };
    promiseThen(
      promise,
      releaseActive,
      () => {
        releaseActive();
        this.releaseIdentityBuild(projectState, canonicalIdentity, promise);
      },
    );
    return promise;
  }

  private isCurrentGeneration(
    cacheKey: string,
    projectState: ProjectImportMapState,
    globalGeneration: object,
    projectGeneration: object,
  ): boolean {
    return this.globalGeneration === globalGeneration &&
      projectState.generation === projectGeneration &&
      mapGet(this.projects, cacheKey) === projectState;
  }

  private removeEmptyProject(
    cacheKey: string,
    projectState: ProjectImportMapState,
  ): void {
    if (
      mapSize(projectState.identityBuilds) === 0 &&
      mapSize(projectState.variants) === 0 &&
      mapGet(this.projects, cacheKey) === projectState
    ) {
      mapDelete(this.projects, cacheKey);
    }
  }

  private startTrackedLoad(
    projectDir: string,
    adapter: RuntimeAdapter,
    config: VeryfrontConfig | undefined,
  ): Promise<ImportMapConfig> {
    if (!this.hasActiveWorkCapacity()) {
      throw this.capacityError("loads");
    }
    const loaderPromise = promiseThen(
      resolvedPromise(),
      () => this.loader(projectDir, adapter, config),
    );
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new IntrinsicPromise<ImportMapConfig>((_, reject) => {
      timeoutId = SetTimeout(() => {
        reject(new IntrinsicRangeError("Import-map preloader load timed out"));
      }, this.loadTimeoutMs);
    });
    const boundedLoaderPromise = promiseThen(
      racePromises([loaderPromise, timeoutPromise]),
      (value) => {
        if (timeoutId !== undefined) ClearTimeout(timeoutId);
        return value;
      },
      (error) => {
        if (timeoutId !== undefined) ClearTimeout(timeoutId);
        throw error;
      },
    );
    const promise = promiseThen(
      boundedLoaderPromise,
      (loadedImportMap) => snapshotImportMap(loadedImportMap),
    );
    this.trackActiveLoad(promise);
    return promise;
  }

  async preload(
    projectDir: string,
    adapter: RuntimeAdapter,
    projectId?: string,
    context?: PreloadImportMapContext,
  ): Promise<ImportMapConfig> {
    for (;;) {
      try {
        return await this.preloadOnce(projectDir, adapter, projectId, context);
      } catch (error) {
        if (!this.isCapacityError(error)) throw error;
        await this.waitForActiveWork();
      }
    }
  }

  private async preloadOnce(
    projectDir: string,
    adapter: RuntimeAdapter,
    projectId?: string,
    context?: PreloadImportMapContext,
  ): Promise<ImportMapConfig> {
    const exactContext = snapshotPreloadContext(context);
    const cacheKey = projectId ?? projectDir;
    const canonicalIdentity = buildVariantCanonicalIdentity(exactContext);
    const admissionNow = this.readNow();
    let projectState = mapGet(this.projects, cacheKey);
    if (!projectState) {
      this.makeProjectRoom(admissionNow);
      projectState = {
        variants: new IntrinsicMap(),
        generation: createGeneration(),
        identityBuilds: new IntrinsicMap(),
      };
      mapSet(this.projects, cacheKey, projectState);
    } else {
      this.touchProject(cacheKey, projectState);
    }

    const globalGeneration = this.globalGeneration;
    const projectGeneration = projectState.generation;

    let identityBuild: Promise<string> | undefined;
    let variantKey: string;
    try {
      identityBuild = this.getOrCreateIdentityBuild(
        projectState,
        canonicalIdentity,
      );
      variantKey = await identityBuild;
    } catch (error) {
      if (identityBuild) {
        this.releaseIdentityBuild(
          projectState,
          canonicalIdentity,
          identityBuild,
        );
      }
      this.removeEmptyProject(cacheKey, projectState);
      throw error;
    }
    const releaseIdentity = (): void => {
      this.releaseIdentityBuild(
        projectState,
        canonicalIdentity,
        identityBuild,
      );
    };

    // Explicit invalidation during asynchronous identity construction must not
    // let pre-clear work enter the post-clear cache generation. The caller can
    // still finish against its immutable request snapshot, but only as bounded,
    // actively-accounted work.
    if (
      !this.isCurrentGeneration(
        cacheKey,
        projectState,
        globalGeneration,
        projectGeneration,
      )
    ) {
      releaseIdentity();
      return this.startTrackedLoad(
        projectDir,
        adapter,
        exactContext?.config,
      );
    }

    let now: number;
    try {
      now = this.readNow();
    } catch (error) {
      releaseIdentity();
      this.removeEmptyProject(cacheKey, projectState);
      throw error;
    }
    // The injected clock is application code and can invalidate synchronously.
    // Recheck after it runs so publication remains generation-atomic.
    if (
      !this.isCurrentGeneration(
        cacheKey,
        projectState,
        globalGeneration,
        projectGeneration,
      )
    ) {
      releaseIdentity();
      return this.startTrackedLoad(
        projectDir,
        adapter,
        exactContext?.config,
      );
    }

    try {
      // Direct expiry refresh must retain the authoritative project state.
      // Removing the empty bucket here would publish the replacement into a
      // detached Map that later callers cannot observe.
      const cached = this.getEntry(cacheKey, variantKey, now, true);
      if (cached) {
        if (cached.expiresAt !== null) {
          releaseIdentity();
        }
        return cached.promise;
      }

      const projectCache = projectState.variants;
      this.makeVariantRoom(projectCache, now);

      const promise = this.startTrackedLoad(
        projectDir,
        adapter,
        exactContext?.config,
      );
      const entry: CachedImportMap = { promise, expiresAt: null };
      mapSet(projectCache, variantKey, entry);

      promiseThen(
        promise,
        () => {
          releaseIdentity();
          if (
            mapGet(this.projects, cacheKey) !== projectState ||
            mapGet(projectCache, variantKey) !== entry
          ) {
            return;
          }
          let settledAt: number;
          try {
            settledAt = this.now();
          } catch (_) {
            this.deleteEntry(cacheKey, projectState, variantKey, entry);
            return;
          }
          if (!NumberIsFinite(settledAt)) {
            this.deleteEntry(cacheKey, projectState, variantKey, entry);
            return;
          }
          entry.expiresAt = MathMin(
            NUMBER_MAX_SAFE_INTEGER,
            settledAt + this.ttlMs,
          );
        },
        () => {
          releaseIdentity();
          this.deleteEntry(cacheKey, projectState, variantKey, entry);
        },
      );

      return promise;
    } catch (error) {
      releaseIdentity();
      this.removeEmptyProject(cacheKey, projectState);
      throw error;
    }
  }

  async getCached(
    cacheKey: string,
    context?: PreloadImportMapContext,
  ): Promise<ImportMapConfig | undefined> {
    const exactContext = snapshotPreloadContext(context);
    const canonicalIdentity = buildVariantCanonicalIdentity(exactContext);
    const projectState = mapGet(this.projects, cacheKey);
    if (!projectState) return undefined;
    const globalGeneration = this.globalGeneration;
    const projectGeneration = projectState.generation;
    let identityBuild: Promise<string> | undefined;
    let variantKey: string;
    try {
      identityBuild = this.getOrCreateIdentityBuild(
        projectState,
        canonicalIdentity,
      );
      variantKey = await identityBuild;
    } catch (error) {
      if (identityBuild) {
        this.releaseIdentityBuild(
          projectState,
          canonicalIdentity,
          identityBuild,
        );
      }
      this.removeEmptyProject(cacheKey, projectState);
      if (!this.isCapacityError(error)) throw error;
      return undefined;
    }
    const releaseIdentity = (): void => {
      this.releaseIdentityBuild(
        projectState,
        canonicalIdentity,
        identityBuild,
      );
    };
    if (
      !this.isCurrentGeneration(
        cacheKey,
        projectState,
        globalGeneration,
        projectGeneration,
      )
    ) {
      releaseIdentity();
      return undefined;
    }
    let entry: CachedImportMap | undefined;
    try {
      entry = this.getEntry(
        cacheKey,
        variantKey,
        this.readNow(),
      );
    } catch (error) {
      releaseIdentity();
      this.removeEmptyProject(cacheKey, projectState);
      if (!this.isCapacityError(error)) throw error;
      return undefined;
    }
    if (!entry) {
      releaseIdentity();
      this.removeEmptyProject(cacheKey, projectState);
      return undefined;
    }
    if (entry.expiresAt !== null) {
      releaseIdentity();
    }

    try {
      return await entry.promise;
    } catch (_) {
      /* expected: the rejection handler removes failed loads */
      return undefined;
    }
  }

  clear(cacheKey?: string): void {
    if (cacheKey !== undefined) {
      const projectState = mapGet(this.projects, cacheKey);
      if (projectState) projectState.generation = createGeneration();
      mapDelete(this.projects, cacheKey);
      return;
    }
    this.globalGeneration = createGeneration();
    mapClear(this.projects);
  }
}

const defaultImportMapPreloader = new ImportMapPreloader();

export function preloadImportMap(
  projectDir: string,
  adapter: RuntimeAdapter,
  projectId?: string,
  context?: PreloadImportMapContext,
): Promise<ImportMapConfig> {
  return defaultImportMapPreloader.preload(projectDir, adapter, projectId, context);
}

export function getCachedImportMap(
  cacheKey: string,
  context?: PreloadImportMapContext,
): Promise<ImportMapConfig | undefined> {
  return defaultImportMapPreloader.getCached(cacheKey, context);
}

export function clearImportMapCache(cacheKey?: string): void {
  defaultImportMapPreloader.clear(cacheKey);
}
