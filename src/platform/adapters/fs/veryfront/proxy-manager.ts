import { logger as baseLogger } from "#veryfront/utils/logger/logger.ts";
import {
  INITIALIZATION_ERROR,
  INVALID_ARGUMENT,
} from "#veryfront/errors/error-registry/general.ts";
import {
  API_CLIENT_ERROR,
  CACHE_INVARIANT_VIOLATION,
} from "#veryfront/errors/error-registry/server.ts";
import type { VeryfrontError } from "#veryfront/errors/types.ts";
import { buildProxyManagerCacheKey } from "#veryfront/cache/keys/index.ts";
import { unrefTimer } from "#veryfront/platform/compat/process.ts";
import { VeryfrontFSAdapter } from "./adapter.ts";
import type { CacheStats, FSAdapterConfig, ResolvedContentContext } from "./types.ts";
import { getGetAdapterParamsSchema } from "./schemas/index.ts";
import { computeHash } from "#veryfront/utils/hash-utils.ts";
import { classifyFilesystemError, toFilesystemPublicError } from "./telemetry.ts";
import {
  assertReadableConfigObject,
  invalidFSAdapterConfig,
  readConfigProperty,
} from "./config-boundary.ts";
import { snapshotProxyFSAdapterBaseConfig } from "./config-snapshot.ts";

const logger = baseLogger.component("proxy-fs-adapter-manager");

const DEFAULT_MAX_ADAPTERS = 100;
const MAX_ADAPTERS = 1_000;
const DEFAULT_MAX_IDLE_MS = 30 * 60 * 1_000;
const AUTHORIZATION_SCOPE_SEPARATOR = ":authorization:";
const MAX_TIMER_DELAY_MS = 2_147_483_647;

async function buildAuthorizationScopedCacheKey(baseCacheKey: string, token: string) {
  const tokenDigest = (await computeHash(token)).slice(0, 32);
  return `${baseCacheKey}${AUTHORIZATION_SCOPE_SEPARATOR}${tokenDigest}`;
}

function isAuthorizationScopedCacheKey(cacheKey: string, baseCacheKey: string): boolean {
  return cacheKey === baseCacheKey ||
    cacheKey.startsWith(`${baseCacheKey}${AUTHORIZATION_SCOPE_SEPARATOR}`);
}

function safeClassifyFilesystemError(error: unknown): string {
  try {
    return classifyFilesystemError(error);
  } catch {
    return "non-error";
  }
}

function safeFilesystemPublicError(error: unknown): VeryfrontError {
  try {
    return toFilesystemPublicError(error);
  } catch {
    return API_CLIENT_ERROR.create({
      detail: "Filesystem operation failed",
      status: 500,
    });
  }
}

function managerDisposedError(): VeryfrontError {
  return INVALID_ARGUMENT.create({
    detail: "Proxy filesystem adapter manager is disposed",
  });
}

function adapterCapacityError(): VeryfrontError {
  return INITIALIZATION_ERROR.create({
    detail: "Filesystem adapter capacity is temporarily unavailable",
    status: 503,
  });
}

function assertProductionRelease(productionMode: boolean, releaseId: string | null): void {
  if (!productionMode || releaseId) return;
  throw CACHE_INVARIANT_VIOLATION.create({
    detail: "Missing releaseId in production",
  });
}

interface ProjectAdapter {
  adapter: VeryfrontFSAdapter;
  lastAccessed: number;
}

interface AdapterCreationCancellation {
  readonly disposed: Promise<void>;
  cancel(): void;
}

function createAdapterCreationCancellation(): AdapterCreationCancellation {
  let cancelled = false;
  let resolveDisposed!: () => void;
  const disposed = new Promise<void>((resolve) => {
    resolveDisposed = resolve;
  });

  return {
    disposed,
    cancel(): void {
      if (cancelled) return;
      cancelled = true;
      resolveDisposed();
    },
  };
}

interface ProxyFSAdapterManagerConfig {
  baseConfig: FSAdapterConfig;
  adapterFactory?: (config: FSAdapterConfig) => VeryfrontFSAdapter;
  maxAdapters?: number;
  cleanupIntervalMs?: number;
  maxIdleMs?: number;
}

interface ResolvedProxyFSAdapterManagerConfig {
  readonly baseConfig: Readonly<FSAdapterConfig>;
  readonly adapterFactory?: (config: FSAdapterConfig) => VeryfrontFSAdapter;
  readonly maxAdapters: number;
  readonly cleanupIntervalMs: number;
  readonly maxIdleMs: number;
}

function snapshotManagerConfig(input: unknown): ResolvedProxyFSAdapterManagerConfig {
  assertReadableConfigObject(input, "Proxy filesystem adapter manager configuration");
  const baseConfig = readConfigProperty(
    input,
    "baseConfig",
    "Proxy filesystem adapter manager configuration",
  );
  const baseConfigSnapshot = snapshotProxyFSAdapterBaseConfig(baseConfig);
  const adapterFactory = readConfigProperty(
    input,
    "adapterFactory",
    "Proxy filesystem adapter manager configuration",
  );
  const configuredMaxAdapters = readConfigProperty(
    input,
    "maxAdapters",
    "Proxy filesystem adapter manager configuration",
  );
  const configuredCleanupIntervalMs = readConfigProperty(
    input,
    "cleanupIntervalMs",
    "Proxy filesystem adapter manager configuration",
  );
  const configuredMaxIdleMs = readConfigProperty(
    input,
    "maxIdleMs",
    "Proxy filesystem adapter manager configuration",
  );
  const maxAdapters = configuredMaxAdapters === undefined
    ? DEFAULT_MAX_ADAPTERS
    : configuredMaxAdapters;
  const cleanupIntervalMs = configuredCleanupIntervalMs === undefined
    ? 0
    : configuredCleanupIntervalMs;
  const maxIdleMs = configuredMaxIdleMs === undefined ? DEFAULT_MAX_IDLE_MS : configuredMaxIdleMs;

  if (adapterFactory !== undefined && typeof adapterFactory !== "function") {
    invalidFSAdapterConfig("Proxy filesystem adapter factory must be a function");
  }
  if (
    !Number.isSafeInteger(maxAdapters) || (maxAdapters as number) <= 0 ||
    (maxAdapters as number) > MAX_ADAPTERS
  ) {
    invalidFSAdapterConfig(
      `Proxy filesystem maxAdapters must be an integer between 1 and ${MAX_ADAPTERS}`,
    );
  }
  if (!Number.isSafeInteger(maxIdleMs) || (maxIdleMs as number) < 0) {
    invalidFSAdapterConfig("Proxy filesystem maxIdleMs must be a non-negative integer");
  }
  if (
    !Number.isSafeInteger(cleanupIntervalMs) || (cleanupIntervalMs as number) < 0 ||
    (cleanupIntervalMs as number) > MAX_TIMER_DELAY_MS
  ) {
    invalidFSAdapterConfig(
      `Proxy filesystem cleanupIntervalMs must be an integer between 0 and ${MAX_TIMER_DELAY_MS}`,
    );
  }

  return Object.freeze({
    baseConfig: baseConfigSnapshot,
    adapterFactory: adapterFactory as ResolvedProxyFSAdapterManagerConfig["adapterFactory"],
    maxAdapters: maxAdapters as number,
    cleanupIntervalMs: cleanupIntervalMs as number,
    maxIdleMs: maxIdleMs as number,
  });
}

export class ProxyFSAdapterManager {
  private adapters = new Map<string, ProjectAdapter>();
  private pendingAdapters = new Map<string, Promise<VeryfrontFSAdapter>>();
  private pendingAdapterInstances = new Map<string, VeryfrontFSAdapter>();
  private pendingAdapterCancellations = new Map<string, AdapterCreationCancellation>();
  private pendingReservations = new Set<string>();
  private disposedAdapters = new WeakSet<object>();
  private readonly adapterFactory: (config: FSAdapterConfig) => VeryfrontFSAdapter;
  private readonly baseConfig: Readonly<FSAdapterConfig>;
  private readonly maxAdapters: number;
  private readonly maxIdleMs: number;
  private cleanupTimer?: ReturnType<typeof setInterval>;
  private disposed = false;
  private generation = 0;

  constructor(config: ProxyFSAdapterManagerConfig) {
    const snapshot = snapshotManagerConfig(config);
    this.baseConfig = snapshot.baseConfig;
    this.adapterFactory = snapshot.adapterFactory ??
      ((adapterConfig) => new VeryfrontFSAdapter(adapterConfig));
    this.maxAdapters = snapshot.maxAdapters;
    this.maxIdleMs = snapshot.maxIdleMs;

    if (snapshot.cleanupIntervalMs > 0) {
      this.cleanupTimer = setInterval(
        (): void => this.cleanupIdleAdapters(),
        snapshot.cleanupIntervalMs,
      );
      unrefTimer(this.cleanupTimer);
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
    this.assertActive();
    const getAdapterStartTime = performance.now();

    const effectiveProductionMode = productionMode ?? false;
    const effectiveReleaseId = releaseId ?? null;
    const effectiveEnvironmentName = environmentName ?? null;
    const effectiveBranch = branch ?? (effectiveProductionMode ? null : "main");

    logger.debug("getAdapter START", {
      productionMode: effectiveProductionMode,
      sourceType: effectiveProductionMode
        ? effectiveEnvironmentName ? "environment" : "release"
        : "branch",
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
        issueCount: validationResult.issues.length,
        invalidFields: validationResult.issues.map((issue) => issue.path.join(".")),
        productionMode: effectiveProductionMode,
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

    const baseCacheKey = buildProxyManagerCacheKey(
      projectSlug,
      effectiveProductionMode,
      effectiveReleaseId,
      effectiveBranch,
      effectiveEnvironmentName,
    );
    const cacheKey = await buildAuthorizationScopedCacheKey(baseCacheKey, token);
    this.assertActive();

    logger.debug("getAdapter called", {
      productionMode: effectiveProductionMode,
      hasExisting: this.adapters.has(cacheKey),
      totalCachedAdapters: this.adapters.size,
    });

    const existing = this.adapters.get(cacheKey);
    if (existing) {
      existing.lastAccessed = Date.now();

      const existingContext = existing.adapter.getContentContext();
      logger.debug("REUSING_CACHED_ADAPTER", {
        cachedSourceType: existingContext?.sourceType,
      });

      this.assertContextMatches(cacheKey, existingContext, {
        productionMode: effectiveProductionMode,
        releaseId: effectiveReleaseId,
        environmentName: effectiveEnvironmentName,
        branch: effectiveBranch,
      });

      return existing.adapter;
    }

    const pending = this.pendingAdapters.get(cacheKey);
    if (pending) {
      logger.debug("Waiting for pending adapter creation");

      const waitStartTime = performance.now();
      const adapter = await pending;
      this.assertActive();

      logger.debug("Pending adapter ready", {
        waitDurationMs: Math.round(performance.now() - waitStartTime),
        totalDurationMs: Math.round(performance.now() - getAdapterStartTime),
      });

      return adapter;
    }

    this.reserveAdapterCapacity(cacheKey);

    logger.debug("Creating new adapter", {
      elapsedBeforeCreateMs: Math.round(performance.now() - getAdapterStartTime),
    });

    const managerGeneration = this.generation;
    const cancellation = createAdapterCreationCancellation();
    this.pendingAdapterCancellations.set(cacheKey, cancellation);
    const creationPromise = this.createAdapter(
      cacheKey,
      projectSlug,
      projectId,
      effectiveProductionMode,
      effectiveReleaseId,
      effectiveEnvironmentName,
      effectiveBranch,
      managerGeneration,
      cancellation.disposed,
    );
    const trackedPromise = creationPromise.finally(() => {
      if (this.pendingAdapters.get(cacheKey) === trackedPromise) {
        this.pendingAdapters.delete(cacheKey);
      }
      this.pendingAdapterInstances.delete(cacheKey);
      if (this.pendingAdapterCancellations.get(cacheKey) === cancellation) {
        this.pendingAdapterCancellations.delete(cacheKey);
      }
      this.pendingReservations.delete(cacheKey);
    });
    this.pendingAdapters.set(cacheKey, trackedPromise);
    return trackedPromise;
  }

  private assertActive(): void {
    if (this.disposed) throw managerDisposedError();
  }

  private isCurrentGeneration(managerGeneration: number): boolean {
    return !this.disposed && managerGeneration === this.generation;
  }

  private getOccupiedAdapterCount(): number {
    const occupiedCacheKeys = new Set(this.pendingReservations);
    for (const cacheKey of this.adapters.keys()) occupiedCacheKeys.add(cacheKey);
    return occupiedCacheKeys.size;
  }

  private reserveAdapterCapacity(cacheKey: string): void {
    if (this.pendingReservations.has(cacheKey) || this.adapters.has(cacheKey)) return;

    if (
      this.getOccupiedAdapterCount() >= this.maxAdapters &&
      !this.evictLeastRecentlyUsed()
    ) {
      throw adapterCapacityError();
    }

    if (this.getOccupiedAdapterCount() >= this.maxAdapters) {
      throw adapterCapacityError();
    }

    this.pendingReservations.add(cacheKey);
  }

  private assertContextMatches(
    _cacheKey: string,
    currentContext: ResolvedContentContext | null | undefined,
    expected: {
      productionMode: boolean;
      releaseId: string | null;
      environmentName: string | null;
      branch: string | null;
    },
  ): void {
    if (!currentContext) {
      logger.error("Null context detected");
      throw CACHE_INVARIANT_VIOLATION.create({
        detail: "Cached filesystem adapter has no content context",
      });
    }

    const mismatchReason = this.getContextMismatchReason(currentContext, expected);
    if (!mismatchReason) return;

    logger.error("Context mismatch detected", {
      mismatchReason,
      currentSourceType: currentContext.sourceType,
      expectedSourceType: expected.productionMode
        ? expected.environmentName ? "environment" : "release"
        : "branch",
    });

    throw CACHE_INVARIANT_VIOLATION.create({
      detail: `Cached filesystem adapter context mismatch (${mismatchReason})`,
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
        return "source-type";
      }

      if (currentContext.releaseId !== expected.releaseId) {
        return "release";
      }

      if (
        expectedSourceType === "environment" &&
        currentContext.environmentName !== expected.environmentName
      ) {
        return "environment";
      }

      return null;
    }

    if (currentContext.sourceType !== "branch") {
      return "source-type";
    }

    if (currentContext.branch !== expected.branch) {
      return "branch";
    }

    return null;
  }

  private async createAdapter(
    cacheKey: string,
    projectSlug: string,
    projectId: string | undefined,
    productionMode: boolean,
    releaseId: string | null,
    environmentName: string | null,
    branch: string | null,
    managerGeneration: number,
    disposalSignal: Promise<void>,
  ): Promise<VeryfrontFSAdapter> {
    logger.debug("Creating NEW adapter", {
      productionMode,
      sourceType: productionMode ? environmentName ? "environment" : "release" : "branch",
      totalCachedAdapters: this.adapters.size,
    });

    let context: ResolvedContentContext;
    if (productionMode) {
      if (!releaseId) {
        throw CACHE_INVARIANT_VIOLATION.create({
          detail: "Production filesystem source requires a release ID",
        });
      }
      context = environmentName
        ? { sourceType: "environment", projectSlug, environmentName, releaseId }
        : { sourceType: "release", projectSlug, releaseId };
    } else {
      if (!branch) {
        throw INVALID_ARGUMENT.create({
          detail: "Preview filesystem source requires a branch",
        });
      }
      context = { sourceType: "branch", projectSlug, branch };
    }

    const initStartTime = performance.now();
    let adapter: VeryfrontFSAdapter | undefined;
    let lateCleanupScheduled = false;
    try {
      const invalidationCallbacks = Object.freeze({
        ...this.baseConfig.invalidationCallbacks,
        evictCurrentAdapter: () => this.evictCacheKey(cacheKey),
      });
      const config: FSAdapterConfig = Object.freeze({
        type: this.baseConfig.type,
        projectDir: this.baseConfig.projectDir,
        veryfront: Object.freeze({
          ...this.baseConfig.veryfront!,
          projectSlug,
          projectId,
        }),
        invalidationCallbacks,
        styleCallbacks: this.baseConfig.styleCallbacks,
      });

      const candidate: unknown = this.adapterFactory(config);
      if (
        (typeof candidate !== "object" && typeof candidate !== "function") ||
        candidate === null
      ) {
        throw new TypeError("Filesystem adapter factory returned an invalid adapter");
      }
      adapter = candidate as VeryfrontFSAdapter;
      this.pendingAdapterInstances.set(cacheKey, adapter);

      if (!this.isCurrentGeneration(managerGeneration)) throw managerDisposedError();

      logger.debug("CONTENT_CONTEXT_SET", {
        productionMode,
        sourceType: context.sourceType,
      });
      adapter.setContentContext(context);
      if (!this.isCurrentGeneration(managerGeneration)) throw managerDisposedError();

      logger.debug("Adapter initialization START", { sourceType: context.sourceType });
      const initializationPromise = Promise.resolve(adapter.initialize());
      const initializationOutcome = await Promise.race([
        initializationPromise.then(() => "initialized" as const),
        disposalSignal.then(() => "disposed" as const),
      ]);
      if (initializationOutcome === "disposed") {
        lateCleanupScheduled = true;
        void initializationPromise.then(
          () => this.disposeAdapter(adapter!, true),
          () => this.disposeAdapter(adapter!, true),
        );
        throw managerDisposedError();
      }
      if (!this.isCurrentGeneration(managerGeneration)) throw managerDisposedError();

      logger.debug("Adapter initialization DONE", {
        sourceType: context.sourceType,
        durationMs: Math.round(performance.now() - initStartTime),
      });

      this.adapters.set(cacheKey, { adapter, lastAccessed: Date.now() });
      this.pendingReservations.delete(cacheKey);
      return adapter;
    } catch (error) {
      const staleGeneration = !this.isCurrentGeneration(managerGeneration);
      if (adapter && !lateCleanupScheduled) this.disposeAdapter(adapter, staleGeneration);
      logger.error("Adapter initialization failed", {
        sourceType: context.sourceType,
        durationMs: Math.round(performance.now() - initStartTime),
        errorClass: safeClassifyFilesystemError(error),
      });
      throw safeFilesystemPublicError(staleGeneration ? managerDisposedError() : error);
    }
  }

  private evictLeastRecentlyUsed(): boolean {
    let oldestCacheKey: string | null = null;
    let oldestTime = Infinity;

    for (const [cacheKey, adapter] of this.adapters) {
      if (adapter.lastAccessed < oldestTime) {
        oldestCacheKey = cacheKey;
        oldestTime = adapter.lastAccessed;
      }
    }

    if (!oldestCacheKey) return false;

    logger.debug("Evicting LRU adapter");

    const adapter = this.adapters.get(oldestCacheKey);
    if (!adapter) return false;

    this.adapters.delete(oldestCacheKey);
    this.disposeAdapter(adapter.adapter);
    return true;
  }

  private cleanupIdleAdapters(): void {
    const now = Date.now();

    for (const [cacheKey, adapter] of this.adapters) {
      if (now - adapter.lastAccessed <= this.maxIdleMs) continue;

      logger.debug("Removing idle adapter");
      this.adapters.delete(cacheKey);
      this.disposeAdapter(adapter.adapter);
    }
  }

  private evictCacheKey(cacheKey: string): boolean {
    const adapter = this.adapters.get(cacheKey);
    if (!adapter) return false;

    logger.debug("Evicting adapter");
    this.adapters.delete(cacheKey);
    this.disposeAdapter(adapter.adapter);
    return true;
  }

  private disposeAdapter(adapter: VeryfrontFSAdapter, allowRepeat = false): void {
    const adapterObject = adapter as unknown as object;
    try {
      if (this.disposedAdapters.has(adapterObject) && !allowRepeat) return;
      if (!this.disposedAdapters.has(adapterObject)) this.disposedAdapters.add(adapterObject);
      const dispose = Reflect.get(adapterObject, "dispose");
      if (typeof dispose === "function") Reflect.apply(dispose, adapterObject, []);
    } catch (error) {
      logger.error("Adapter disposal failed", {
        errorClass: safeClassifyFilesystemError(error),
      });
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
    assertProductionRelease(effectiveProductionMode, releaseId ?? null);
    const baseCacheKey = buildProxyManagerCacheKey(
      projectSlug,
      effectiveProductionMode,
      releaseId ?? null,
      branch ?? null,
      effectiveEnvironmentName,
    );
    return [...this.adapters.keys()].some((cacheKey) =>
      isAuthorizationScopedCacheKey(cacheKey, baseCacheKey)
    );
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
    assertProductionRelease(effectiveProductionMode, releaseId ?? null);
    const baseCacheKey = buildProxyManagerCacheKey(
      projectSlug,
      effectiveProductionMode,
      releaseId ?? null,
      branch ?? null,
      effectiveEnvironmentName,
    );

    let evicted = false;
    for (const cacheKey of [...this.adapters.keys()]) {
      if (!isAuthorizationScopedCacheKey(cacheKey, baseCacheKey)) continue;
      evicted = this.evictCacheKey(cacheKey) || evicted;
    }

    if (!evicted) logger.debug("No adapter to evict");
  }

  getStats(): { adapters: number; stats: Record<string, CacheStats> } {
    const stats: Record<string, CacheStats> = {};

    let adapterNumber = 0;
    for (const adapter of this.adapters.values()) {
      stats[`adapter_${++adapterNumber}`] = adapter.adapter.getCacheStats();
    }

    return { adapters: this.adapters.size, stats };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.generation++;

    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }

    const adaptersToDispose = [
      ...[...this.adapters.values()].map((entry) => entry.adapter),
      ...this.pendingAdapterInstances.values(),
    ];
    const pendingCancellations = [...this.pendingAdapterCancellations.values()];
    this.adapters.clear();
    this.pendingAdapterInstances.clear();
    this.pendingAdapterCancellations.clear();
    this.pendingAdapters.clear();
    this.pendingReservations.clear();

    for (const adapter of adaptersToDispose) {
      logger.debug("Disposing adapter");
      this.disposeAdapter(adapter);
    }
    for (const cancellation of pendingCancellations) cancellation.cancel();

    logger.debug("Disposed");
  }
}
