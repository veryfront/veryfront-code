import { logger as baseLogger } from "#veryfront/utils/logger/logger.ts";
import { CACHE_INVARIANT_VIOLATION } from "#veryfront/errors/error-registry.ts";
import { INVALID_ARGUMENT } from "#veryfront/errors/error-registry/general.ts";
import { SERVICE_OVERLOADED } from "#veryfront/errors/error-registry/server.ts";
import { buildProxyManagerCacheKey } from "#veryfront/cache/keys/index.ts";
import { VeryfrontFSAdapter } from "./adapter.ts";
import type { CacheStats, FSAdapterConfig, ResolvedContentContext } from "./types.ts";
import { getGetAdapterParamsSchema } from "./schemas/index.ts";
import { createDefaultInvalidationCallbacks } from "./default-invalidation-callbacks.ts";

const logger = baseLogger.component("proxy-fs-adapter-manager");

const DEFAULT_MAX_ADAPTERS = 100;
const DEFAULT_MAX_IDLE_MS = 30 * 60 * 1_000;
const SHA256_DIGEST_BYTES = 32;

function requirePositiveSafeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
  return value;
}

interface ProjectAdapter {
  adapter: VeryfrontFSAdapter;
  capabilities: CapturedAdapterCapabilities;
  lastAccessed: number;
  initializing?: Promise<void>;
  identity: ProxyAdapterIdentity;
}

type CapturedAdapterMethod = (...args: never[]) => unknown;

interface CapturedAdapterCapabilities {
  dispose: CapturedAdapterMethod;
  getCacheStats: CapturedAdapterMethod;
  getContentContext: CapturedAdapterMethod;
  initialize: CapturedAdapterMethod;
  setContentContext: CapturedAdapterMethod;
}

interface ProxyAdapterIdentity {
  projectSlug: string;
  projectId: string | null;
  credentialPrincipal: string;
  productionMode: boolean;
  releaseId: string | null;
  environmentName: string | null;
  branch: string | null;
}

type ProxyAdapterDiagnosticIdentity = Omit<ProxyAdapterIdentity, "credentialPrincipal">;

const encodeText = TextEncoder.prototype.encode;
const subtleDigest = crypto.subtle.digest.bind(crypto.subtle);
const textEncoder = new TextEncoder();
const NativeUint8Array = Uint8Array;
const IntrinsicReflectApply = Reflect.apply;
const IntrinsicObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const IntrinsicObjectGetPrototypeOf = Object.getPrototypeOf;
const IntrinsicPerformance = performance;
const PerformanceNow = IntrinsicPerformance.now;
const DateNow = Date.now;
const IntrinsicObjectFreeze = Object.freeze;
const NumberPrototypeToFixed = Number.prototype.toFixed;
const NumberPrototypeToString = Number.prototype.toString;
const StringPrototypePadStart = String.prototype.padStart;
const StringPrototypeTrim = String.prototype.trim;
const VeryfrontFSAdapterPrototype = VeryfrontFSAdapter.prototype;
const VeryfrontFSAdapterDispose = VeryfrontFSAdapterPrototype.dispose;
const VeryfrontFSAdapterGetCacheStats = VeryfrontFSAdapterPrototype.getCacheStats;
const VeryfrontFSAdapterGetContentContext = VeryfrontFSAdapterPrototype.getContentContext;
const VeryfrontFSAdapterInitialize = VeryfrontFSAdapterPrototype.initialize;
const VeryfrontFSAdapterSetContentContext = VeryfrontFSAdapterPrototype.setContentContext;
type GetAdapterParamsSchema = ReturnType<typeof getGetAdapterParamsSchema>;
type GetAdapterParamsValidationResult = ReturnType<
  GetAdapterParamsSchema["safeParse"]
>;
let capturedGetAdapterParamsSchema: GetAdapterParamsSchema | undefined;
let capturedGetAdapterParamsSchemaSafeParse: GetAdapterParamsSchema["safeParse"] | undefined;

function captureGetAdapterParamsValidator(): void {
  if (capturedGetAdapterParamsSchema && capturedGetAdapterParamsSchemaSafeParse) return;
  const schema = getGetAdapterParamsSchema();
  capturedGetAdapterParamsSchema = schema;
  capturedGetAdapterParamsSchemaSafeParse = schema.safeParse;
}

function performanceNow(): number {
  return IntrinsicReflectApply(PerformanceNow, IntrinsicPerformance, []) as number;
}

function formatDuration(durationMs: number): string {
  return `${IntrinsicReflectApply(NumberPrototypeToFixed, durationMs, [2]) as string}ms`;
}

function currentTime(): number {
  return IntrinsicReflectApply(DateNow, Date, []) as number;
}

function trimString(value: string): string {
  return IntrinsicReflectApply(StringPrototypeTrim, value, []) as string;
}

function captureAdapterMethod(
  adapter: VeryfrontFSAdapter,
  key: keyof CapturedAdapterCapabilities,
  concreteMethod: CapturedAdapterMethod,
): CapturedAdapterMethod {
  const ownDescriptor = IntrinsicReflectApply(
    IntrinsicObjectGetOwnPropertyDescriptor,
    Object,
    [adapter, key],
  ) as PropertyDescriptor | undefined;
  if (ownDescriptor !== undefined) {
    if (!("value" in ownDescriptor) || typeof ownDescriptor.value !== "function") {
      throw new TypeError(`Veryfront filesystem adapter ${key} must be a data-property method`);
    }
    return ownDescriptor.value as CapturedAdapterMethod;
  }

  let owner = IntrinsicReflectApply(IntrinsicObjectGetPrototypeOf, Object, [adapter]) as
    | object
    | null;
  for (let depth = 0; owner !== null && depth < 64; depth++) {
    if (owner === VeryfrontFSAdapterPrototype) return concreteMethod;
    const descriptor = IntrinsicReflectApply(
      IntrinsicObjectGetOwnPropertyDescriptor,
      Object,
      [owner, key],
    ) as PropertyDescriptor | undefined;
    if (descriptor !== undefined) {
      if (!("value" in descriptor) || typeof descriptor.value !== "function") {
        throw new TypeError(`Veryfront filesystem adapter ${key} must be a data-property method`);
      }
      return descriptor.value as CapturedAdapterMethod;
    }
    owner = IntrinsicReflectApply(IntrinsicObjectGetPrototypeOf, Object, [owner]) as object | null;
  }
  throw new TypeError(`Veryfront filesystem adapter ${key} must inherit a function`);
}

function captureAdapterCapabilities(adapter: VeryfrontFSAdapter): CapturedAdapterCapabilities {
  return {
    dispose: captureAdapterMethod(adapter, "dispose", VeryfrontFSAdapterDispose),
    getCacheStats: captureAdapterMethod(
      adapter,
      "getCacheStats",
      VeryfrontFSAdapterGetCacheStats,
    ),
    getContentContext: captureAdapterMethod(
      adapter,
      "getContentContext",
      VeryfrontFSAdapterGetContentContext,
    ),
    initialize: captureAdapterMethod(adapter, "initialize", VeryfrontFSAdapterInitialize),
    setContentContext: captureAdapterMethod(
      adapter,
      "setContentContext",
      VeryfrontFSAdapterSetContentContext,
    ),
  };
}

function getAdapterContentContext(
  projectAdapter: ProjectAdapter,
): ResolvedContentContext | null | undefined {
  return IntrinsicReflectApply(
    projectAdapter.capabilities.getContentContext,
    projectAdapter.adapter,
    [],
  ) as ResolvedContentContext | null | undefined;
}

function disposeProjectAdapter(projectAdapter: ProjectAdapter): void {
  IntrinsicReflectApply(
    projectAdapter.capabilities.dispose,
    projectAdapter.adapter,
    [],
  );
}

async function hashCredentialPrincipal(token: string): Promise<string> {
  const bytes = IntrinsicReflectApply(encodeText, textEncoder, [token]) as ReturnType<
    typeof encodeText
  >;
  const digest = new NativeUint8Array(await subtleDigest("SHA-256", bytes));
  let principal = "";
  for (let index = 0; index < SHA256_DIGEST_BYTES; index++) {
    const encoded = IntrinsicReflectApply(NumberPrototypeToString, digest[index]!, [16]) as string;
    principal += IntrinsicReflectApply(StringPrototypePadStart, encoded, [2, "0"]) as string;
  }
  return principal;
}

function buildDiagnosticCacheKey(identity: ProxyAdapterIdentity): string {
  return buildProxyManagerCacheKey(
    identity.projectSlug,
    identity.productionMode,
    identity.releaseId,
    identity.branch,
    identity.environmentName,
    { projectId: identity.projectId, credentialPrincipal: "[redacted]" },
  );
}

function getDiagnosticIdentity(identity: ProxyAdapterIdentity): ProxyAdapterDiagnosticIdentity {
  return {
    projectSlug: identity.projectSlug,
    projectId: identity.projectId,
    productionMode: identity.productionMode,
    releaseId: identity.releaseId,
    environmentName: identity.environmentName,
    branch: identity.branch,
  };
}

interface ProxyFSAdapterManagerConfig {
  baseConfig: FSAdapterConfig;
  adapterFactory?: (config: FSAdapterConfig) => VeryfrontFSAdapter;
  maxAdapters?: number;
  cleanupIntervalMs?: number;
  maxIdleMs?: number;
  now?: () => number;
}

export class ProxyFSAdapterManager {
  #adapters = new Map<string, ProjectAdapter>();
  #pendingAdapters = new Map<string, Promise<ProjectAdapter>>();
  private adapterFactory: (config: FSAdapterConfig) => VeryfrontFSAdapter;
  private baseConfig: FSAdapterConfig;
  private maxAdapters: number;
  private maxIdleMs: number;
  private cleanupTimer?: ReturnType<typeof setInterval>;
  #now: () => number;

  constructor(config: ProxyFSAdapterManagerConfig) {
    captureGetAdapterParamsValidator();
    this.baseConfig = config.baseConfig;
    this.adapterFactory = config.adapterFactory ??
      ((adapterConfig) => new VeryfrontFSAdapter(adapterConfig));
    this.maxAdapters = requirePositiveSafeInteger(
      config.maxAdapters ?? DEFAULT_MAX_ADAPTERS,
      "maxAdapters",
    );
    this.maxIdleMs = config.maxIdleMs ?? DEFAULT_MAX_IDLE_MS;
    this.#now = config.now ?? currentTime;

    if (config.cleanupIntervalMs) {
      this.cleanupTimer = setInterval(
        (): void => this.cleanupIdleAdapters(),
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
    onResolved?: (initializedNow: boolean) => void,
  ): Promise<VeryfrontFSAdapter> {
    const getAdapterStartTime = performanceNow();

    const effectiveProductionMode = productionMode ?? false;
    // All three must use the same predicate the cache key uses, or an identity
    // that is not part of the key can still differ and fail the reuse assertion.
    const effectiveReleaseId = effectiveProductionMode ? (releaseId ?? null) : null;
    const effectiveEnvironmentName = environmentName || null;
    const effectiveBranch = effectiveProductionMode ? null : (branch ?? "main");
    const canonicalProjectId = projectId === undefined ? undefined : trimString(projectId);
    if (
      this.baseConfig.veryfront?.proxyMode === true &&
      (!canonicalProjectId || projectId !== canonicalProjectId)
    ) {
      throw INVALID_ARGUMENT.create({
        detail: "[ProxyFSAdapterManager] Hosted proxy adapters require a canonical project ID",
      });
    }

    logger.debug("getAdapter START", {
      projectSlug,
      productionMode: effectiveProductionMode,
      releaseId: effectiveReleaseId,
      environmentName: effectiveEnvironmentName,
      branch: effectiveBranch,
    });

    const validationResult = IntrinsicReflectApply(
      capturedGetAdapterParamsSchemaSafeParse!,
      capturedGetAdapterParamsSchema!,
      [{
        projectSlug,
        token,
        projectId,
        productionMode: effectiveProductionMode,
        releaseId: effectiveReleaseId,
        environmentName: effectiveEnvironmentName,
        branch: effectiveBranch,
      }],
    ) as GetAdapterParamsValidationResult;

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

    const credentialPrincipal = await hashCredentialPrincipal(token);
    const identity: ProxyAdapterIdentity = IntrinsicObjectFreeze({
      projectSlug,
      projectId: projectId ?? null,
      credentialPrincipal,
      productionMode: effectiveProductionMode,
      releaseId: effectiveReleaseId,
      environmentName: effectiveEnvironmentName,
      branch: effectiveBranch,
    });

    const cacheKey = buildProxyManagerCacheKey(
      projectSlug,
      effectiveProductionMode,
      effectiveReleaseId,
      effectiveBranch,
      effectiveEnvironmentName,
      { projectId: identity.projectId, credentialPrincipal },
    );
    const diagnosticCacheKey = buildDiagnosticCacheKey(identity);

    logger.debug("getAdapter called", {
      projectSlug,
      productionMode: effectiveProductionMode,
      releaseId: effectiveReleaseId,
      environmentName: effectiveEnvironmentName,
      branch: effectiveBranch,
      cacheKey: diagnosticCacheKey,
      hasExisting: this.#adapters.has(cacheKey),
      totalCachedAdapters: this.#adapters.size,
    });

    const existing = this.#adapters.get(cacheKey);
    if (existing) {
      existing.lastAccessed = this.#now();

      const existingContext = getAdapterContentContext(existing);
      logger.debug("REUSING_CACHED_ADAPTER", {
        cacheKey: diagnosticCacheKey,
        requestedReleaseId: effectiveReleaseId,
        cachedSourceType: existingContext?.sourceType,
        cachedReleaseId: existingContext?.releaseId,
      });

      try {
        this.assertContextMatches(diagnosticCacheKey, existing, existingContext, identity);
      } catch (error) {
        this.evictAdapterByCacheKey(cacheKey);
        throw error;
      }

      onResolved?.(false);
      return existing.adapter;
    }

    const pending = this.#pendingAdapters.get(cacheKey);
    if (pending) {
      logger.debug("Waiting for pending adapter creation", {
        cacheKey: diagnosticCacheKey,
        projectSlug,
      });

      const waitStartTime = performanceNow();
      const projectAdapter = await pending;
      const initialized = this.#adapters.get(cacheKey);
      if (!initialized) {
        disposeProjectAdapter(projectAdapter);
        throw CACHE_INVARIANT_VIOLATION.create({
          detail: `[ProxyFSAdapterManager] Pending adapter completed without a cache identity`,
        });
      }

      try {
        this.assertContextMatches(
          diagnosticCacheKey,
          initialized,
          getAdapterContentContext(projectAdapter),
          identity,
        );
      } catch (error) {
        this.evictAdapterByCacheKey(cacheKey);
        throw error;
      }

      logger.debug("Pending adapter ready", {
        cacheKey: diagnosticCacheKey,
        waitDuration: formatDuration(performanceNow() - waitStartTime),
        totalDuration: formatDuration(performanceNow() - getAdapterStartTime),
      });

      onResolved?.(true);
      return projectAdapter.adapter;
    }

    // A pending initialization already owns a cache slot. Counting only
    // completed adapters lets a burst of distinct tenant/credential identities
    // initialize without bound and then commit past maxAdapters. Reuse an LRU
    // completed slot when possible; if every slot is initializing, fail fast
    // without starting more work.
    if (this.#adapters.size + this.#pendingAdapters.size >= this.maxAdapters) {
      const evicted = this.evictLeastRecentlyUsed();
      if (!evicted) {
        throw SERVICE_OVERLOADED.create({
          detail: "Proxy filesystem adapter initialization capacity is exhausted",
        });
      }
    }

    logger.debug("Creating new adapter", {
      cacheKey: diagnosticCacheKey,
      projectSlug,
      elapsedBeforeCreate: formatDuration(performanceNow() - getAdapterStartTime),
    });

    const projectAdapter = await this.#createAdapter(
      cacheKey,
      diagnosticCacheKey,
      projectSlug,
      token,
      projectId,
      effectiveProductionMode,
      effectiveReleaseId,
      effectiveEnvironmentName,
      effectiveBranch,
      identity,
    );
    onResolved?.(true);
    return projectAdapter.adapter;
  }

  private assertContextMatches(
    diagnosticCacheKey: string,
    cached: ProjectAdapter,
    currentContext: ResolvedContentContext | null | undefined,
    expected: ProxyAdapterIdentity,
  ): void {
    const cachedIdentityMismatch = this.getIdentityMismatchReason(cached.identity, expected);
    if (cachedIdentityMismatch) {
      logger.error("Adapter identity mismatch detected", {
        cacheKey: diagnosticCacheKey,
        cachedIdentity: getDiagnosticIdentity(cached.identity),
        expected: getDiagnosticIdentity(expected),
        mismatchReason: cachedIdentityMismatch,
      });
      throw CACHE_INVARIANT_VIOLATION.create({
        detail: `[ProxyFSAdapterManager] FATAL: Identity mismatch for cached adapter. ` +
          `Reason: ${cachedIdentityMismatch}. CacheKey: ${diagnosticCacheKey}`,
      });
    }

    if (!currentContext) {
      logger.error("Null context detected", { cacheKey: diagnosticCacheKey });
      throw CACHE_INVARIANT_VIOLATION.create({
        detail: `[ProxyFSAdapterManager] FATAL: Cached adapter has null context. ` +
          `This indicates a critical bug in adapter initialization. ` +
          `CacheKey: ${diagnosticCacheKey}`,
      });
    }

    const mismatchReason = this.getContextMismatchReason(currentContext, expected);
    if (!mismatchReason) return;

    logger.error("Context mismatch detected", {
      cacheKey: diagnosticCacheKey,
      currentContext,
      expected: getDiagnosticIdentity(expected),
      mismatchReason,
    });

    throw CACHE_INVARIANT_VIOLATION.create({
      detail: `[ProxyFSAdapterManager] FATAL: Context mismatch for cached adapter. ` +
        `This indicates a critical bug in adapter caching. ` +
        `Reason: ${mismatchReason}. ` +
        `Expected: ${JSON.stringify(getDiagnosticIdentity(expected))} ` +
        `Got: ${JSON.stringify(currentContext)} ` +
        `CacheKey: ${diagnosticCacheKey}`,
    });
  }

  private getIdentityMismatchReason(
    actual: ProxyAdapterIdentity,
    expected: ProxyAdapterIdentity,
  ): string | null {
    const fields: Array<keyof ProxyAdapterIdentity> = [
      "projectSlug",
      "projectId",
      "credentialPrincipal",
      "productionMode",
      "releaseId",
      "environmentName",
      "branch",
    ];
    for (const field of fields) {
      if (actual[field] !== expected[field]) return `Cached ${field} does not match the request`;
    }
    return null;
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

  #createAdapter(
    cacheKey: string,
    diagnosticCacheKey: string,
    projectSlug: string,
    token: string,
    projectId: string | undefined,
    productionMode: boolean,
    releaseId: string | null,
    environmentName: string | null,
    branch: string | null,
    identity: ProxyAdapterIdentity,
  ): Promise<ProjectAdapter> {
    logger.debug("Creating NEW adapter", {
      cacheKey: diagnosticCacheKey,
      projectSlug,
      productionMode,
      releaseId,
      environmentName,
      branch,
      totalCachedAdapters: this.#adapters.size,
    });

    const config: FSAdapterConfig = {
      ...this.baseConfig,
      veryfront: {
        ...this.baseConfig.veryfront,
        projectSlug,
        projectId,
        apiToken: token,
      },
      invalidationCallbacks: createDefaultInvalidationCallbacks({
        ...this.baseConfig.invalidationCallbacks,
        evictCurrentAdapter: () => this.evictAdapterByCacheKey(cacheKey),
      }),
    };

    const adapter = this.adapterFactory(config);
    const capabilities = captureAdapterCapabilities(adapter);

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
      cacheKey: diagnosticCacheKey,
      projectSlug,
      productionMode,
      releaseId,
      environmentName,
      sourceType: context.sourceType,
      contextReleaseId: "releaseId" in context ? context.releaseId : "N/A",
    });

    IntrinsicReflectApply(capabilities.setContentContext, adapter, [context]);

    const projectAdapter: ProjectAdapter = {
      adapter,
      capabilities,
      lastAccessed: this.#now(),
      identity,
    };

    // Defer initialization until after its promise is registered. This makes
    // capacity admission atomic even when initialize() throws synchronously.
    const initPromise = Promise.resolve().then(async (): Promise<ProjectAdapter> => {
      const initStartTime = performanceNow();

      logger.debug("Adapter initialization START", {
        cacheKey: diagnosticCacheKey,
        projectSlug,
      });

      try {
        projectAdapter.initializing = IntrinsicReflectApply(
          capabilities.initialize,
          adapter,
          [],
        ) as Promise<void>;
        await projectAdapter.initializing;

        logger.debug("Adapter initialization DONE", {
          cacheKey: diagnosticCacheKey,
          projectSlug,
          duration: formatDuration(performanceNow() - initStartTime),
        });

        this.#adapters.set(cacheKey, projectAdapter);
        return projectAdapter;
      } catch (error) {
        logger.error("Adapter initialization failed", {
          cacheKey: diagnosticCacheKey,
          projectSlug,
          duration: formatDuration(performanceNow() - initStartTime),
          error: error instanceof Error ? error.message : String(error),
        });

        // The failed adapter is never cached, so nothing else releases the
        // resources it may have allocated before initialize() threw.
        try {
          disposeProjectAdapter(projectAdapter);
        } catch (disposeError) {
          logger.debug("Adapter dispose after failed initialization threw", {
            cacheKey: diagnosticCacheKey,
            error: disposeError instanceof Error ? disposeError.message : String(disposeError),
          });
        }

        throw error;
      } finally {
        projectAdapter.initializing = undefined;
        this.#pendingAdapters.delete(cacheKey);
      }
    });

    this.#pendingAdapters.set(cacheKey, initPromise);
    return initPromise;
  }

  private evictLeastRecentlyUsed(): boolean {
    let oldestCacheKey: string | null = null;
    let oldestTime = Infinity;

    for (const [cacheKey, adapter] of this.#adapters) {
      if (adapter.lastAccessed < oldestTime) {
        oldestCacheKey = cacheKey;
        oldestTime = adapter.lastAccessed;
      }
    }

    if (!oldestCacheKey) return false;

    const adapter = this.#adapters.get(oldestCacheKey);
    if (!adapter) return false;
    logger.debug("Evicting LRU adapter", {
      cacheKey: buildDiagnosticCacheKey(adapter.identity),
    });

    disposeProjectAdapter(adapter);
    this.#adapters.delete(oldestCacheKey);
    return true;
  }

  private cleanupIdleAdapters(): void {
    const now = this.#now();

    for (const [cacheKey, adapter] of this.#adapters) {
      if (now - adapter.lastAccessed <= this.maxIdleMs) continue;

      logger.debug("Removing idle adapter", {
        cacheKey: buildDiagnosticCacheKey(adapter.identity),
      });
      disposeProjectAdapter(adapter);
      this.#adapters.delete(cacheKey);
    }
  }

  hasAdapter(
    projectSlug: string,
    productionMode?: boolean,
    releaseId?: string | null,
    branch?: string | null,
    environmentName?: string | null,
    projectId?: string,
  ): boolean {
    this.assertValidSelection(projectSlug, productionMode, releaseId);
    return Array.from(this.#adapters.values()).some(({ identity }) =>
      this.matchesAdapterSelection(
        identity,
        projectSlug,
        productionMode,
        releaseId,
        branch,
        environmentName,
        projectId,
      )
    );
  }

  evictAdapter(
    projectSlug: string,
    productionMode?: boolean,
    releaseId?: string | null,
    branch?: string | null,
    environmentName?: string | null,
    projectId?: string,
  ): void {
    this.assertValidSelection(projectSlug, productionMode, releaseId);
    let evicted = false;
    for (const [cacheKey, { identity }] of this.#adapters) {
      if (
        !this.matchesAdapterSelection(
          identity,
          projectSlug,
          productionMode,
          releaseId,
          branch,
          environmentName,
          projectId,
        )
      ) continue;
      this.evictAdapterByCacheKey(cacheKey);
      evicted = true;
    }
    if (!evicted) logger.debug("No adapter to evict", { projectSlug });
  }

  private evictAdapterByCacheKey(cacheKey: string): void {
    const adapter = this.#adapters.get(cacheKey);
    if (!adapter) return;
    logger.debug("Evicting adapter", {
      cacheKey: buildDiagnosticCacheKey(adapter.identity),
    });
    disposeProjectAdapter(adapter);
    this.#adapters.delete(cacheKey);
  }

  private matchesAdapterSelection(
    identity: ProxyAdapterIdentity,
    projectSlug: string,
    productionMode = false,
    releaseId: string | null = null,
    branch: string | null = null,
    environmentName: string | null = null,
    projectId?: string,
  ): boolean {
    if (identity.projectSlug !== projectSlug || identity.productionMode !== productionMode) {
      return false;
    }
    if (projectId !== undefined && identity.projectId !== projectId) return false;
    if (productionMode) {
      return identity.releaseId === releaseId &&
        identity.environmentName === environmentName;
    }
    return identity.branch === (branch ?? "main");
  }

  private assertValidSelection(
    projectSlug: string,
    productionMode = false,
    releaseId: string | null = null,
  ): void {
    if (productionMode && !releaseId) {
      throw CACHE_INVARIANT_VIOLATION.create({
        detail: `Missing releaseId in production for ${projectSlug}`,
      });
    }
  }

  getStats(): { adapters: number; stats: Record<string, CacheStats> } {
    const stats: Record<string, CacheStats> = {};
    const diagnosticKeyCounts = new Map<string, number>();

    for (const adapter of this.#adapters.values()) {
      const diagnosticKey = buildDiagnosticCacheKey(adapter.identity);
      const keyCount = (diagnosticKeyCounts.get(diagnosticKey) ?? 0) + 1;
      diagnosticKeyCounts.set(diagnosticKey, keyCount);
      const statsKey = keyCount === 1 ? diagnosticKey : `${diagnosticKey}:instance:${keyCount}`;
      stats[statsKey] = IntrinsicReflectApply(
        adapter.capabilities.getCacheStats,
        adapter.adapter,
        [],
      ) as CacheStats;
    }

    return { adapters: this.#adapters.size, stats };
  }

  dispose(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }

    for (const adapter of this.#adapters.values()) {
      logger.debug("Disposing adapter", {
        cacheKey: buildDiagnosticCacheKey(adapter.identity),
      });
      disposeProjectAdapter(adapter);
    }

    this.#adapters.clear();
    logger.debug("Disposed");
  }
}
