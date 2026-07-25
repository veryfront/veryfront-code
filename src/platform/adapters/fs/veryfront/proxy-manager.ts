import { logger as baseLogger } from "#veryfront/utils/logger/logger.ts";
import {
  CACHE_INVARIANT_VIOLATION,
  INITIALIZATION_ERROR,
  SERVICE_OVERLOADED,
} from "#veryfront/errors/error-registry.ts";
import { INVALID_ARGUMENT } from "#veryfront/errors/error-registry/general.ts";
import { buildProxyManagerCacheKey } from "#veryfront/cache/keys/index.ts";
import { VeryfrontFSAdapter } from "./adapter.ts";
import type { CacheStats, FSAdapterConfig, ResolvedContentContext } from "./types.ts";
import { getGetAdapterParamsSchema } from "./schemas/index.ts";
import { createDefaultInvalidationCallbacks } from "./default-invalidation-callbacks.ts";
import {
  getCurrentRequestContext,
  registerRequestContextFinalizer,
  type RequestContext,
} from "./request-context.ts";

const logger = baseLogger.component("proxy-fs-adapter-manager");

const DEFAULT_MAX_ADAPTERS = 100;
const DEFAULT_MAX_IDLE_MS = 30 * 60 * 1_000;
const IntrinsicAggregateError = AggregateError;
const IntrinsicMap = Map;
const IntrinsicSet = Set;
const IntrinsicWeakMap = WeakMap;
const ArrayPrototypePush = Array.prototype.push;
const DateNow = Date.now;
const MapPrototypeClear = Map.prototype.clear;
const MapPrototypeDelete = Map.prototype.delete;
const MapPrototypeForEach = Map.prototype.forEach;
const MapPrototypeGet = Map.prototype.get;
const MapPrototypeHas = Map.prototype.has;
const MapPrototypeSet = Map.prototype.set;
const MapSizeDescriptor = Object.getOwnPropertyDescriptor(Map.prototype, "size");
const NumberIsInteger = Number.isInteger;
const PerformanceNow = performance.now;
const ReflectApply = Reflect.apply;
const SetPrototypeAdd = Set.prototype.add;
const SetPrototypeDelete = Set.prototype.delete;
const SetPrototypeHas = Set.prototype.has;
const SetSizeDescriptor = Object.getOwnPropertyDescriptor(Set.prototype, "size");
const WeakMapPrototypeDelete = WeakMap.prototype.delete;
const WeakMapPrototypeGet = WeakMap.prototype.get;
const WeakMapPrototypeSet = WeakMap.prototype.set;

if (
  typeof MapSizeDescriptor?.get !== "function" ||
  typeof SetSizeDescriptor?.get !== "function"
) {
  throw new TypeError("Required collection size getter is unavailable");
}
const MapSizeGetter = MapSizeDescriptor.get;
const SetSizeGetter = SetSizeDescriptor.get;

function arrayPush<T>(array: T[], value: T): void {
  ReflectApply(ArrayPrototypePush, array, [value]);
}

function monotonicNow(): number {
  return ReflectApply(PerformanceNow, performance, []) as number;
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

function mapHas<K, V>(map: Map<K, V>, key: K): boolean {
  return ReflectApply(MapPrototypeHas, map, [key]) as boolean;
}

function mapSet<K, V>(map: Map<K, V>, key: K, value: V): void {
  ReflectApply(MapPrototypeSet, map, [key, value]);
}

function mapSize<K, V>(map: Map<K, V>): number {
  return ReflectApply(MapSizeGetter, map, []) as number;
}

function setAdd<T>(set: Set<T>, value: T): void {
  ReflectApply(SetPrototypeAdd, set, [value]);
}

function setDelete<T>(set: Set<T>, value: T): boolean {
  return ReflectApply(SetPrototypeDelete, set, [value]) as boolean;
}

function setHas<T>(set: Set<T>, value: T): boolean {
  return ReflectApply(SetPrototypeHas, set, [value]) as boolean;
}

function setSize<T>(set: Set<T>): number {
  return ReflectApply(SetSizeGetter, set, []) as number;
}

function weakMapDelete<K extends object, V>(map: WeakMap<K, V>, key: K): void {
  ReflectApply(WeakMapPrototypeDelete, map, [key]);
}

function weakMapGet<K extends object, V>(map: WeakMap<K, V>, key: K): V | undefined {
  return ReflectApply(WeakMapPrototypeGet, map, [key]) as V | undefined;
}

function weakMapSet<K extends object, V>(map: WeakMap<K, V>, key: K, value: V): void {
  ReflectApply(WeakMapPrototypeSet, map, [key, value]);
}

function throwCleanupFailures(failures: unknown[], message: string): void {
  if (failures.length === 0) return;
  if (failures.length === 1) throw failures[0];
  throw new IntrinsicAggregateError(failures, message);
}

interface ProjectAdapter {
  adapter: VeryfrontFSAdapter;
  lastAccessed: number;
  projectId?: string;
  initializing?: Promise<void>;
  activeLeases: number;
  evictionRequested: boolean;
  cancelled: boolean;
  disposed: boolean;
  initializationInvoked: boolean;
}

interface ProxyFSAdapterManagerConfig {
  baseConfig: FSAdapterConfig;
  adapterFactory?: (config: FSAdapterConfig) => VeryfrontFSAdapter;
  maxAdapters?: number;
  cleanupIntervalMs?: number;
  maxIdleMs?: number;
}

export class ProxyFSAdapterManager {
  private adapters = new IntrinsicMap<string, ProjectAdapter>();
  private pendingAdapters = new IntrinsicMap<string, Promise<VeryfrontFSAdapter>>();
  private pendingAdapterEntries = new IntrinsicMap<string, ProjectAdapter>();
  private pendingProjectIds = new IntrinsicMap<string, string | undefined>();
  private contextLeases = new IntrinsicWeakMap<RequestContext, Set<ProjectAdapter>>();
  private adapterFactory: (config: FSAdapterConfig) => VeryfrontFSAdapter;
  private baseConfig: FSAdapterConfig;
  private maxAdapters: number;
  private maxIdleMs: number;
  private cleanupTimer?: ReturnType<typeof setInterval>;
  private disposed = false;

  constructor(config: ProxyFSAdapterManagerConfig) {
    this.baseConfig = config.baseConfig;
    this.adapterFactory = config.adapterFactory ??
      ((adapterConfig) => new VeryfrontFSAdapter(adapterConfig));
    this.maxAdapters = config.maxAdapters ?? DEFAULT_MAX_ADAPTERS;
    this.maxIdleMs = config.maxIdleMs ?? DEFAULT_MAX_IDLE_MS;

    if (!NumberIsInteger(this.maxAdapters) || this.maxAdapters < 1) {
      throw INVALID_ARGUMENT.create({
        detail: "[ProxyFSAdapterManager] maxAdapters must be a positive integer",
      });
    }

    if (config.cleanupIntervalMs) {
      this.cleanupTimer = setInterval(
        (): void => {
          try {
            this.cleanupIdleAdapters();
          } catch (error) {
            logger.error("Idle adapter cleanup failed", {
              error: error instanceof Error ? error.message : String(error),
            });
          }
        },
        config.cleanupIntervalMs,
      );
    }

    logger.debug("Created", {
      maxAdapters: this.maxAdapters,
      maxIdleMs: this.maxIdleMs,
    });
  }

  async getAdapter(
    projectSlug: string,
    token: string,
    projectId?: string,
    productionMode?: boolean,
    releaseId?: string | null,
    environmentName?: string | null,
    branch?: string | null,
  ): Promise<VeryfrontFSAdapter> {
    if (this.disposed) {
      throw INITIALIZATION_ERROR.create({
        detail: "[ProxyFSAdapterManager] Cannot get an adapter after the manager is disposed",
      });
    }

    const getAdapterStartTime = monotonicNow();
    const requestContext = getCurrentRequestContext();

    const effectiveProductionMode = productionMode ?? false;
    const effectiveReleaseId = releaseId ?? null;
    const effectiveEnvironmentName = environmentName ?? null;
    const effectiveBranch = branch ?? (effectiveProductionMode ? null : "main");

    logger.debug("getAdapter START", {
      projectSlug,
      productionMode: effectiveProductionMode,
      releaseId: effectiveReleaseId,
      environmentName: effectiveEnvironmentName,
      branch: effectiveBranch,
    });

    const validationResult = getGetAdapterParamsSchema().safeParse({
      projectSlug,
      token,
      projectId,
      productionMode: effectiveProductionMode,
      releaseId: effectiveReleaseId,
      environmentName: effectiveEnvironmentName,
      branch: effectiveBranch,
    });

    if (!validationResult.success) {
      logger.error("Validation failed", {
        errors: validationResult.issues,
        params: {
          projectSlug,
          productionMode: effectiveProductionMode,
          releaseId: effectiveReleaseId,
          environmentName: effectiveEnvironmentName,
          branch: effectiveBranch,
        },
      });
      const detailMessage = validationResult.issues
        .map((issue) =>
          issue.path.length > 0 ? `${issue.path.join(".")}: ${issue.message}` : issue.message
        )
        .join("; ");
      throw INVALID_ARGUMENT.create({
        detail: `[ProxyFSAdapterManager] Invalid getAdapter parameters: ${detailMessage}`,
      });
    }

    const cacheKey = buildProxyManagerCacheKey(
      projectSlug,
      effectiveProductionMode,
      effectiveReleaseId,
      effectiveBranch,
      effectiveEnvironmentName,
    );

    logger.debug("getAdapter called", {
      projectSlug,
      productionMode: effectiveProductionMode,
      releaseId: effectiveReleaseId,
      environmentName: effectiveEnvironmentName,
      branch: effectiveBranch,
      cacheKey,
      hasExisting: mapHas(this.adapters, cacheKey),
      totalCachedAdapters: mapSize(this.adapters),
    });

    const existing = mapGet(this.adapters, cacheKey);
    if (existing) {
      if (existing.evictionRequested) {
        throw SERVICE_OVERLOADED.create({
          detail:
            `[ProxyFSAdapterManager] Adapter eviction is pending for ${projectSlug}; retry the request`,
        });
      }
      this.assertProjectIdMatches(cacheKey, existing.projectId, projectId);

      const existingContext = existing.adapter.getContentContext();
      logger.debug("REUSING_CACHED_ADAPTER", {
        cacheKey,
        requestedReleaseId: effectiveReleaseId,
        cachedSourceType: existingContext?.sourceType,
        cachedReleaseId: existingContext?.releaseId,
      });

      this.assertContextMatches(cacheKey, existingContext, {
        productionMode: effectiveProductionMode,
        releaseId: effectiveReleaseId,
        environmentName: effectiveEnvironmentName,
        branch: effectiveBranch,
      });

      existing.lastAccessed = DateNow();
      this.acquireContextLease(requestContext, cacheKey, existing);
      return existing.adapter;
    }

    const pending = mapGet(this.pendingAdapters, cacheKey);
    if (pending) {
      this.assertProjectIdMatches(
        cacheKey,
        mapGet(this.pendingProjectIds, cacheKey),
        projectId,
      );
      logger.debug("Waiting for pending adapter creation", {
        cacheKey,
        projectSlug,
      });

      const waitStartTime = monotonicNow();
      const adapter = await pending;
      const pendingEntry = mapGet(this.adapters, cacheKey);
      if (!pendingEntry || pendingEntry.adapter !== adapter) {
        throw CACHE_INVARIANT_VIOLATION.create({
          detail:
            `[ProxyFSAdapterManager] Pending adapter completed without a matching cache entry. ` +
            `CacheKey: ${cacheKey}`,
        });
      }
      if (pendingEntry.evictionRequested) {
        throw SERVICE_OVERLOADED.create({
          detail:
            `[ProxyFSAdapterManager] Adapter eviction is pending for ${projectSlug}; retry the request`,
        });
      }
      pendingEntry.lastAccessed = DateNow();
      this.acquireContextLease(requestContext, cacheKey, pendingEntry);

      logger.debug("Pending adapter ready", {
        cacheKey,
        waitDuration: `${(monotonicNow() - waitStartTime).toFixed(2)}ms`,
        totalDuration: `${(monotonicNow() - getAdapterStartTime).toFixed(2)}ms`,
      });

      return adapter;
    }

    if (mapSize(this.adapters) + mapSize(this.pendingAdapters) >= this.maxAdapters) {
      const evicted = this.evictLeastRecentlyUsed();
      if (!evicted) {
        throw SERVICE_OVERLOADED.create({
          detail:
            `[ProxyFSAdapterManager] Adapter capacity (${this.maxAdapters}) is fully leased or initializing; retry the request`,
        });
      }
    }

    logger.debug("Creating new adapter", {
      cacheKey,
      projectSlug,
      elapsedBeforeCreate: `${(monotonicNow() - getAdapterStartTime).toFixed(2)}ms`,
    });

    return this.createAdapter(
      cacheKey,
      projectSlug,
      projectId,
      effectiveProductionMode,
      effectiveReleaseId,
      effectiveEnvironmentName,
      effectiveBranch,
      requestContext,
    );
  }

  private acquireContextLease(
    context: RequestContext | null,
    cacheKey: string,
    projectAdapter: ProjectAdapter,
  ): void {
    if (!context) return;

    let leases = weakMapGet(this.contextLeases, context);
    if (!leases) {
      leases = new IntrinsicSet();
      weakMapSet(this.contextLeases, context, leases);
    }
    if (setHas(leases, projectAdapter)) return;

    const registered = registerRequestContextFinalizer(
      context,
      () => this.releaseContextLease(context, cacheKey, projectAdapter),
    );
    if (!registered) return;

    setAdd(leases, projectAdapter);
    projectAdapter.activeLeases++;
  }

  private releaseContextLease(
    context: RequestContext,
    cacheKey: string,
    projectAdapter: ProjectAdapter,
  ): void {
    const leases = weakMapGet(this.contextLeases, context);
    if (!leases || !setDelete(leases, projectAdapter)) return;
    if (setSize(leases) === 0) weakMapDelete(this.contextLeases, context);

    if (projectAdapter.activeLeases < 1) {
      throw CACHE_INVARIANT_VIOLATION.create({
        detail: `[ProxyFSAdapterManager] Adapter lease count underflow. CacheKey: ${cacheKey}`,
      });
    }
    projectAdapter.activeLeases--;

    if (
      projectAdapter.activeLeases === 0 &&
      projectAdapter.evictionRequested &&
      mapGet(this.adapters, cacheKey) === projectAdapter
    ) {
      mapDelete(this.adapters, cacheKey);
      const cleanupFailure = this.disposeProjectAdapter(projectAdapter);
      if (cleanupFailure) throw cleanupFailure.error;
    }
  }

  private assertContextMatches(
    cacheKey: string,
    currentContext: ResolvedContentContext | null | undefined,
    expected: {
      productionMode: boolean;
      releaseId: string | null;
      environmentName: string | null;
      branch: string | null;
    },
  ): void {
    if (!currentContext) {
      logger.error("Null context detected", { cacheKey });
      throw CACHE_INVARIANT_VIOLATION.create({
        detail: `[ProxyFSAdapterManager] FATAL: Cached adapter has null context. ` +
          `This indicates a critical bug in adapter initialization. ` +
          `CacheKey: ${cacheKey}`,
      });
    }

    const mismatchReason = this.getContextMismatchReason(currentContext, expected);
    if (!mismatchReason) return;

    logger.error("Context mismatch detected", {
      cacheKey,
      currentContext,
      expected,
      mismatchReason,
    });

    throw CACHE_INVARIANT_VIOLATION.create({
      detail: `[ProxyFSAdapterManager] FATAL: Context mismatch for cached adapter. ` +
        `This indicates a critical bug in adapter caching. ` +
        `Reason: ${mismatchReason}. ` +
        `Expected: ${JSON.stringify(expected)} ` +
        `Got: ${JSON.stringify(currentContext)} ` +
        `CacheKey: ${cacheKey}`,
    });
  }

  private assertProjectIdMatches(
    cacheKey: string,
    adapterProjectId: string | undefined,
    requestedProjectId: string | undefined,
  ): void {
    if (adapterProjectId === requestedProjectId) return;

    logger.error("Project identity mismatch detected", {
      cacheKey,
      adapterProjectId,
      requestedProjectId,
    });
    throw CACHE_INVARIANT_VIOLATION.create({
      detail:
        `[ProxyFSAdapterManager] Cached adapter project identity does not match the request. ` +
        `CacheKey: ${cacheKey}`,
    });
  }

  private getContextMismatchReason(
    currentContext: ResolvedContentContext,
    expected: {
      productionMode: boolean;
      releaseId: string | null;
      environmentName: string | null;
      branch: string | null;
    },
  ): string | null {
    if (expected.productionMode) {
      const expectedSourceType = expected.environmentName ? "environment" : "release";
      if (currentContext.sourceType !== expectedSourceType) {
        return `Expected sourceType "${expectedSourceType}", got "${currentContext.sourceType}"`;
      }

      if (currentContext.releaseId !== expected.releaseId) {
        return `Expected releaseId "${expected.releaseId}", got "${currentContext.releaseId}"`;
      }

      if (
        expectedSourceType === "environment" &&
        currentContext.environmentName !== expected.environmentName
      ) {
        return `Expected environmentName "${expected.environmentName}", got "${currentContext.environmentName}"`;
      }

      return null;
    }

    if (currentContext.sourceType !== "branch") {
      return `Expected sourceType "branch", got "${currentContext.sourceType}"`;
    }

    if (currentContext.branch !== expected.branch) {
      return `Expected branch "${expected.branch}", got "${currentContext.branch}"`;
    }

    return null;
  }

  private createAdapter(
    cacheKey: string,
    projectSlug: string,
    projectId: string | undefined,
    productionMode: boolean,
    releaseId: string | null,
    environmentName: string | null,
    branch: string | null,
    requestContext: RequestContext | null,
  ): Promise<VeryfrontFSAdapter> {
    logger.debug("Creating NEW adapter", {
      cacheKey,
      projectSlug,
      productionMode,
      releaseId,
      environmentName,
      branch,
      totalCachedAdapters: mapSize(this.adapters),
    });

    const config: FSAdapterConfig = {
      ...this.baseConfig,
      veryfront: {
        ...this.baseConfig.veryfront,
        projectSlug,
        projectId,
        // Manager-owned adapters are shared. They must never retain either the
        // first request token or a host-level token as ambient authority.
        apiToken: undefined,
        proxyMode: true,
      },
      invalidationCallbacks: createDefaultInvalidationCallbacks({
        ...this.baseConfig.invalidationCallbacks,
        evictCurrentAdapter: () =>
          this.evictAdapter(projectSlug, productionMode, releaseId, branch, environmentName),
      }),
    };

    const adapter = this.adapterFactory(config);

    let context: ResolvedContentContext;
    if (productionMode) {
      if (!releaseId) {
        throw CACHE_INVARIANT_VIOLATION.create({
          detail:
            `[ProxyFSAdapterManager] production source requires releaseId (projectSlug=${projectSlug})`,
        });
      }
      context = environmentName
        ? { sourceType: "environment", projectSlug, environmentName, releaseId }
        : { sourceType: "release", projectSlug, releaseId };
    } else {
      if (!branch) {
        throw INVALID_ARGUMENT.create({
          detail:
            `[ProxyFSAdapterManager] createAdapter: productionMode=false requires branch (projectSlug=${projectSlug})`,
        });
      }
      context = { sourceType: "branch", projectSlug, branch };
    }

    logger.debug("CONTENT_CONTEXT_SET", {
      cacheKey,
      projectSlug,
      productionMode,
      releaseId,
      environmentName,
      sourceType: context.sourceType,
      contextReleaseId: "releaseId" in context ? context.releaseId : "N/A",
    });

    adapter.setContentContext(context);

    const projectAdapter: ProjectAdapter = {
      adapter,
      lastAccessed: DateNow(),
      projectId,
      activeLeases: 0,
      evictionRequested: false,
      cancelled: false,
      disposed: false,
      initializationInvoked: false,
    };

    const initPromise = (async (): Promise<VeryfrontFSAdapter> => {
      // Register the pending entry before adapter initialization can settle,
      // including when a custom adapter throws synchronously.
      await Promise.resolve();
      const initStartTime = monotonicNow();

      logger.debug("Adapter initialization START", {
        cacheKey,
        projectSlug,
      });

      try {
        if (this.disposed) {
          throw INITIALIZATION_ERROR.create({
            detail: `[ProxyFSAdapterManager] Manager was disposed before adapter initialization. ` +
              `CacheKey: ${cacheKey}`,
          });
        }
        if (projectAdapter.cancelled) {
          throw SERVICE_OVERLOADED.create({
            detail: `[ProxyFSAdapterManager] Adapter initialization was invalidated. ` +
              `CacheKey: ${cacheKey}`,
          });
        }

        projectAdapter.initializationInvoked = true;
        projectAdapter.initializing = adapter.initialize();
        await projectAdapter.initializing;

        if (this.disposed) {
          throw INITIALIZATION_ERROR.create({
            detail: `[ProxyFSAdapterManager] Manager was disposed during adapter initialization. ` +
              `CacheKey: ${cacheKey}`,
          });
        }
        if (projectAdapter.cancelled) {
          throw SERVICE_OVERLOADED.create({
            detail: `[ProxyFSAdapterManager] Adapter initialization was invalidated. ` +
              `CacheKey: ${cacheKey}`,
          });
        }

        logger.debug("Adapter initialization DONE", {
          cacheKey,
          projectSlug,
          duration: `${(monotonicNow() - initStartTime).toFixed(2)}ms`,
        });

        projectAdapter.lastAccessed = DateNow();
        mapSet(this.adapters, cacheKey, projectAdapter);
        this.acquireContextLease(requestContext, cacheKey, projectAdapter);
        return adapter;
      } catch (error) {
        const cleanupFailure = this.disposeProjectAdapter(
          projectAdapter,
          projectAdapter.initializationInvoked && projectAdapter.disposed,
        );
        if (cleanupFailure) {
          // Initialization is the primary failure. Cleanup failures are logged
          // but must not replace it, and all manager indexes are still cleared
          // in the finally block below.
          logger.error("Adapter cleanup after initialization failure also failed", {
            cacheKey,
            projectSlug,
            error: cleanupFailure.error instanceof Error
              ? cleanupFailure.error.message
              : String(cleanupFailure.error),
          });
        }
        logger.error("Adapter initialization failed", {
          cacheKey,
          projectSlug,
          duration: `${(monotonicNow() - initStartTime).toFixed(2)}ms`,
          error: error instanceof Error ? error.message : String(error),
        });

        throw error;
      } finally {
        projectAdapter.initializing = undefined;
        mapDelete(this.pendingAdapters, cacheKey);
        mapDelete(this.pendingAdapterEntries, cacheKey);
        mapDelete(this.pendingProjectIds, cacheKey);
      }
    })();

    mapSet(this.pendingAdapters, cacheKey, initPromise);
    mapSet(this.pendingAdapterEntries, cacheKey, projectAdapter);
    mapSet(this.pendingProjectIds, cacheKey, projectId);
    return initPromise;
  }

  private evictLeastRecentlyUsed(): boolean {
    let oldestCacheKey: string | null = null;
    let oldestTime = Infinity;

    mapForEach(this.adapters, (adapter, cacheKey) => {
      if (adapter.activeLeases > 0 || adapter.evictionRequested) return;
      if (adapter.lastAccessed < oldestTime) {
        oldestCacheKey = cacheKey;
        oldestTime = adapter.lastAccessed;
      }
    });

    if (!oldestCacheKey) return false;

    logger.debug("Evicting LRU adapter", { cacheKey: oldestCacheKey });

    const adapter = mapGet(this.adapters, oldestCacheKey);
    if (!adapter) return false;

    mapDelete(this.adapters, oldestCacheKey);
    const cleanupFailure = this.disposeProjectAdapter(adapter);
    if (cleanupFailure) throw cleanupFailure.error;
    return true;
  }

  private cleanupIdleAdapters(): void {
    const now = DateNow();
    const cleanupFailures: unknown[] = [];

    mapForEach(this.adapters, (adapter, cacheKey) => {
      if (adapter.activeLeases > 0) return;
      if (now - adapter.lastAccessed <= this.maxIdleMs) return;

      logger.debug("Removing idle adapter", { cacheKey });
      mapDelete(this.adapters, cacheKey);
      const cleanupFailure = this.disposeProjectAdapter(adapter);
      if (cleanupFailure) arrayPush(cleanupFailures, cleanupFailure.error);
    });
    throwCleanupFailures(cleanupFailures, "Multiple idle adapter disposals failed");
  }

  private disposeProjectAdapter(
    projectAdapter: ProjectAdapter,
    force = false,
  ): { readonly error: unknown } | null {
    if (projectAdapter.disposed && !force) return null;
    projectAdapter.disposed = true;
    try {
      projectAdapter.adapter.dispose();
      return null;
    } catch (error) {
      return { error };
    }
  }

  hasAdapter(
    projectSlug: string,
    productionMode?: boolean,
    releaseId?: string | null,
    branch?: string | null,
    environmentName?: string | null,
  ): boolean {
    const effectiveProductionMode = productionMode ?? false;
    const effectiveEnvironmentName = environmentName ?? null;
    const cacheKey = buildProxyManagerCacheKey(
      projectSlug,
      effectiveProductionMode,
      releaseId ?? null,
      branch ?? null,
      effectiveEnvironmentName,
    );
    return mapHas(this.adapters, cacheKey);
  }

  evictAdapter(
    projectSlug: string,
    productionMode?: boolean,
    releaseId?: string | null,
    branch?: string | null,
    environmentName?: string | null,
  ): void {
    const effectiveProductionMode = productionMode ?? false;
    const effectiveEnvironmentName = environmentName ?? null;
    const cacheKey = buildProxyManagerCacheKey(
      projectSlug,
      effectiveProductionMode,
      releaseId ?? null,
      branch ?? null,
      effectiveEnvironmentName,
    );

    const adapter = mapGet(this.adapters, cacheKey);
    if (adapter) {
      if (adapter.activeLeases > 0) {
        adapter.evictionRequested = true;
        logger.debug("Deferring adapter eviction until active requests complete", {
          cacheKey,
          activeLeases: adapter.activeLeases,
        });
        return;
      }

      logger.debug("Evicting adapter", { cacheKey });
      mapDelete(this.adapters, cacheKey);
      const cleanupFailure = this.disposeProjectAdapter(adapter);
      if (cleanupFailure) throw cleanupFailure.error;
      return;
    }

    const pendingAdapter = mapGet(this.pendingAdapterEntries, cacheKey);
    if (pendingAdapter) {
      pendingAdapter.cancelled = true;
      const cleanupFailure = this.disposeProjectAdapter(pendingAdapter);
      logger.debug("Cancelled pending adapter initialization", { cacheKey });
      if (cleanupFailure) throw cleanupFailure.error;
      return;
    }

    logger.debug("No adapter to evict", { cacheKey });
  }

  getStats(): { adapters: number; stats: Record<string, CacheStats> } {
    const stats: Record<string, CacheStats> = {};

    mapForEach(this.adapters, (adapter, cacheKey) => {
      stats[cacheKey] = adapter.adapter.getCacheStats();
    });

    return { adapters: mapSize(this.adapters), stats };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }

    const cleanupFailures: unknown[] = [];
    mapForEach(this.adapters, (adapter, cacheKey) => {
      logger.debug("Disposing adapter", { cacheKey });
      adapter.cancelled = true;
      const cleanupFailure = this.disposeProjectAdapter(adapter);
      if (cleanupFailure) arrayPush(cleanupFailures, cleanupFailure.error);
    });

    mapForEach(this.pendingAdapterEntries, (adapter, cacheKey) => {
      logger.debug("Disposing pending adapter", { cacheKey });
      adapter.cancelled = true;
      const cleanupFailure = this.disposeProjectAdapter(adapter);
      if (cleanupFailure) arrayPush(cleanupFailures, cleanupFailure.error);
    });

    mapClear(this.adapters);
    mapClear(this.pendingAdapters);
    mapClear(this.pendingAdapterEntries);
    mapClear(this.pendingProjectIds);
    logger.debug("Disposed");
    throwCleanupFailures(cleanupFailures, "Multiple proxy adapter disposals failed");
  }
}
