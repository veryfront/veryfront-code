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

function requirePositiveSafeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
  return value;
}

interface ProjectAdapter {
  adapter: VeryfrontFSAdapter;
  lastAccessed: number;
  initializing?: Promise<void>;
  identity: ProxyAdapterIdentity;
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
const IntrinsicReflectApply = Reflect.apply;
const IntrinsicUint8Array = Uint8Array;
const NumberPrototypeToString = Number.prototype.toString;

async function hashCredentialPrincipal(token: string): Promise<string> {
  const bytes = IntrinsicReflectApply(encodeText, textEncoder, [token]) as Uint8Array<ArrayBuffer>;
  const digest = new IntrinsicUint8Array(await subtleDigest("SHA-256", bytes));
  let principal = "";
  for (let index = 0; index < digest.length; index++) {
    const hex = IntrinsicReflectApply(NumberPrototypeToString, digest[index], [16]) as string;
    principal += hex.length === 1 ? `0${hex}` : hex;
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
}

export class ProxyFSAdapterManager {
  private adapters = new Map<string, ProjectAdapter>();
  private pendingAdapters = new Map<string, Promise<VeryfrontFSAdapter>>();
  private adapterFactory: (config: FSAdapterConfig) => VeryfrontFSAdapter;
  private baseConfig: FSAdapterConfig;
  private maxAdapters: number;
  private maxIdleMs: number;
  private cleanupTimer?: ReturnType<typeof setInterval>;

  constructor(config: ProxyFSAdapterManagerConfig) {
    this.baseConfig = config.baseConfig;
    this.adapterFactory = config.adapterFactory ??
      ((adapterConfig) => new VeryfrontFSAdapter(adapterConfig));
    this.maxAdapters = requirePositiveSafeInteger(
      config.maxAdapters ?? DEFAULT_MAX_ADAPTERS,
      "maxAdapters",
    );
    this.maxIdleMs = config.maxIdleMs ?? DEFAULT_MAX_IDLE_MS;

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
    const getAdapterStartTime = performance.now();

    const effectiveProductionMode = productionMode ?? false;
    // All three must use the same predicate the cache key uses, or an identity
    // that is not part of the key can still differ and fail the reuse assertion.
    const effectiveReleaseId = effectiveProductionMode ? (releaseId ?? null) : null;
    const effectiveEnvironmentName = environmentName || null;
    const effectiveBranch = effectiveProductionMode ? null : (branch ?? "main");

    if (
      this.baseConfig.veryfront?.proxyMode === true &&
      (!projectId?.trim() || projectId !== projectId.trim())
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

    const credentialPrincipal = await hashCredentialPrincipal(token);
    const identity: ProxyAdapterIdentity = Object.freeze({
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
      hasExisting: this.adapters.has(cacheKey),
      totalCachedAdapters: this.adapters.size,
    });

    const existing = this.adapters.get(cacheKey);
    if (existing) {
      existing.lastAccessed = Date.now();

      const existingContext = existing.adapter.getContentContext();
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

    const pending = this.pendingAdapters.get(cacheKey);
    if (pending) {
      logger.debug("Waiting for pending adapter creation", {
        cacheKey: diagnosticCacheKey,
        projectSlug,
      });

      const waitStartTime = performance.now();
      const adapter = await pending;
      const initialized = this.adapters.get(cacheKey);
      if (!initialized) {
        adapter.dispose();
        throw CACHE_INVARIANT_VIOLATION.create({
          detail: `[ProxyFSAdapterManager] Pending adapter completed without a cache identity`,
        });
      }

      try {
        this.assertContextMatches(
          diagnosticCacheKey,
          initialized,
          adapter.getContentContext(),
          identity,
        );
      } catch (error) {
        this.evictAdapterByCacheKey(cacheKey);
        throw error;
      }

      logger.debug("Pending adapter ready", {
        cacheKey: diagnosticCacheKey,
        waitDuration: `${(performance.now() - waitStartTime).toFixed(2)}ms`,
        totalDuration: `${(performance.now() - getAdapterStartTime).toFixed(2)}ms`,
      });

      onResolved?.(true);
      return adapter;
    }

    // A pending initialization already owns a cache slot. Counting only
    // completed adapters lets a burst of distinct tenant/credential identities
    // initialize without bound and then commit past maxAdapters. Reuse an LRU
    // completed slot when possible; if every slot is initializing, fail fast
    // without starting more work.
    if (this.adapters.size + this.pendingAdapters.size >= this.maxAdapters) {
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
      elapsedBeforeCreate: `${(performance.now() - getAdapterStartTime).toFixed(2)}ms`,
    });

    const adapter = await this.createAdapter(
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
    return adapter;
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

  private createAdapter(
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
  ): Promise<VeryfrontFSAdapter> {
    logger.debug("Creating NEW adapter", {
      cacheKey: diagnosticCacheKey,
      projectSlug,
      productionMode,
      releaseId,
      environmentName,
      branch,
      totalCachedAdapters: this.adapters.size,
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

    adapter.setContentContext(context);

    const projectAdapter: ProjectAdapter = { adapter, lastAccessed: Date.now(), identity };

    // Defer initialization until after its promise is registered. This makes
    // capacity admission atomic even when initialize() throws synchronously.
    const initPromise = Promise.resolve().then(async (): Promise<VeryfrontFSAdapter> => {
      const initStartTime = performance.now();

      logger.debug("Adapter initialization START", {
        cacheKey: diagnosticCacheKey,
        projectSlug,
      });

      try {
        projectAdapter.initializing = adapter.initialize();
        await projectAdapter.initializing;

        logger.debug("Adapter initialization DONE", {
          cacheKey: diagnosticCacheKey,
          projectSlug,
          duration: `${(performance.now() - initStartTime).toFixed(2)}ms`,
        });

        this.adapters.set(cacheKey, projectAdapter);
        return adapter;
      } catch (error) {
        logger.error("Adapter initialization failed", {
          cacheKey: diagnosticCacheKey,
          projectSlug,
          duration: `${(performance.now() - initStartTime).toFixed(2)}ms`,
          error: error instanceof Error ? error.message : String(error),
        });

        // The failed adapter is never cached, so nothing else releases the
        // resources it may have allocated before initialize() threw.
        try {
          adapter.dispose();
        } catch (disposeError) {
          logger.debug("Adapter dispose after failed initialization threw", {
            cacheKey: diagnosticCacheKey,
            error: disposeError instanceof Error ? disposeError.message : String(disposeError),
          });
        }

        throw error;
      } finally {
        projectAdapter.initializing = undefined;
        this.pendingAdapters.delete(cacheKey);
      }
    });

    this.pendingAdapters.set(cacheKey, initPromise);
    return initPromise;
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

    const adapter = this.adapters.get(oldestCacheKey);
    if (!adapter) return false;
    logger.debug("Evicting LRU adapter", {
      cacheKey: buildDiagnosticCacheKey(adapter.identity),
    });

    adapter.adapter.dispose();
    this.adapters.delete(oldestCacheKey);
    return true;
  }

  private cleanupIdleAdapters(): void {
    const now = Date.now();

    for (const [cacheKey, adapter] of this.adapters) {
      if (now - adapter.lastAccessed <= this.maxIdleMs) continue;

      logger.debug("Removing idle adapter", {
        cacheKey: buildDiagnosticCacheKey(adapter.identity),
      });
      adapter.adapter.dispose();
      this.adapters.delete(cacheKey);
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
    return Array.from(this.adapters.values()).some(({ identity }) =>
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
    for (const [cacheKey, { identity }] of this.adapters) {
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
    const adapter = this.adapters.get(cacheKey);
    if (!adapter) return;
    logger.debug("Evicting adapter", {
      cacheKey: buildDiagnosticCacheKey(adapter.identity),
    });
    adapter.adapter.dispose();
    this.adapters.delete(cacheKey);
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

    for (const adapter of this.adapters.values()) {
      const diagnosticKey = buildDiagnosticCacheKey(adapter.identity);
      const keyCount = (diagnosticKeyCounts.get(diagnosticKey) ?? 0) + 1;
      diagnosticKeyCounts.set(diagnosticKey, keyCount);
      const statsKey = keyCount === 1 ? diagnosticKey : `${diagnosticKey}:instance:${keyCount}`;
      stats[statsKey] = adapter.adapter.getCacheStats();
    }

    return { adapters: this.adapters.size, stats };
  }

  dispose(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }

    for (const adapter of this.adapters.values()) {
      logger.debug("Disposing adapter", {
        cacheKey: buildDiagnosticCacheKey(adapter.identity),
      });
      adapter.adapter.dispose();
    }

    this.adapters.clear();
    logger.debug("Disposed");
  }
}
