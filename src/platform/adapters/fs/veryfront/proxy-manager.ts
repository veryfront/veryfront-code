import { logger as baseLogger } from "#veryfront/utils/logger/logger.ts";
import { CACHE_INVARIANT_VIOLATION } from "#veryfront/errors/error-registry.ts";
import { INVALID_ARGUMENT } from "#veryfront/errors/error-registry/general.ts";
import { buildProxyManagerCacheKey } from "#veryfront/cache/keys/index.ts";
import { VeryfrontFSAdapter } from "./adapter.ts";
import type { CacheStats, FSAdapterConfig, ResolvedContentContext } from "./types.ts";
import { getGetAdapterParamsSchema } from "./schemas/index.ts";
import { createDefaultInvalidationCallbacks } from "./default-invalidation-callbacks.ts";

const logger = baseLogger.component("proxy-fs-adapter-manager");

const DEFAULT_MAX_ADAPTERS = 100;
const DEFAULT_MAX_IDLE_MS = 30 * 60 * 1_000;

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

const encodeText = TextEncoder.prototype.encode;
const subtleDigest = crypto.subtle.digest.bind(crypto.subtle);
const textEncoder = new TextEncoder();

async function hashCredentialPrincipal(token: string): Promise<string> {
  const bytes = encodeText.call(textEncoder, token);
  const digest = new Uint8Array(await subtleDigest("SHA-256", bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
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
    this.maxAdapters = config.maxAdapters ?? DEFAULT_MAX_ADAPTERS;
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
  ): Promise<VeryfrontFSAdapter> {
    const getAdapterStartTime = performance.now();

    const effectiveProductionMode = productionMode ?? false;
    const effectiveReleaseId = releaseId ?? null;
    const effectiveEnvironmentName = environmentName ?? null;
    const effectiveBranch = branch ?? (effectiveProductionMode ? null : "main");

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

    logger.debug("getAdapter called", {
      projectSlug,
      productionMode: effectiveProductionMode,
      releaseId: effectiveReleaseId,
      environmentName: effectiveEnvironmentName,
      branch: effectiveBranch,
      cacheKey,
      hasExisting: this.adapters.has(cacheKey),
      totalCachedAdapters: this.adapters.size,
    });

    const existing = this.adapters.get(cacheKey);
    if (existing) {
      existing.lastAccessed = Date.now();

      const existingContext = existing.adapter.getContentContext();
      logger.debug("REUSING_CACHED_ADAPTER", {
        cacheKey,
        requestedReleaseId: effectiveReleaseId,
        cachedSourceType: existingContext?.sourceType,
        cachedReleaseId: existingContext?.releaseId,
      });

      try {
        this.assertContextMatches(cacheKey, existing, existingContext, identity);
      } catch (error) {
        this.evictAdapterByCacheKey(cacheKey);
        throw error;
      }

      return existing.adapter;
    }

    const pending = this.pendingAdapters.get(cacheKey);
    if (pending) {
      logger.debug("Waiting for pending adapter creation", {
        cacheKey,
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
          cacheKey,
          initialized,
          adapter.getContentContext(),
          identity,
        );
      } catch (error) {
        this.evictAdapterByCacheKey(cacheKey);
        throw error;
      }

      logger.debug("Pending adapter ready", {
        cacheKey,
        waitDuration: `${(performance.now() - waitStartTime).toFixed(2)}ms`,
        totalDuration: `${(performance.now() - getAdapterStartTime).toFixed(2)}ms`,
      });

      return adapter;
    }

    if (this.adapters.size >= this.maxAdapters) {
      this.evictLeastRecentlyUsed();
    }

    logger.debug("Creating new adapter", {
      cacheKey,
      projectSlug,
      elapsedBeforeCreate: `${(performance.now() - getAdapterStartTime).toFixed(2)}ms`,
    });

    return this.createAdapter(
      cacheKey,
      projectSlug,
      token,
      projectId,
      effectiveProductionMode,
      effectiveReleaseId,
      effectiveEnvironmentName,
      effectiveBranch,
      identity,
    );
  }

  private assertContextMatches(
    cacheKey: string,
    cached: ProjectAdapter,
    currentContext: ResolvedContentContext | null | undefined,
    expected: ProxyAdapterIdentity,
  ): void {
    const cachedIdentityMismatch = this.getIdentityMismatchReason(cached.identity, expected);
    if (cachedIdentityMismatch) {
      logger.error("Adapter identity mismatch detected", {
        cacheKey,
        cachedIdentity: cached.identity,
        expected,
        mismatchReason: cachedIdentityMismatch,
      });
      throw CACHE_INVARIANT_VIOLATION.create({
        detail: `[ProxyFSAdapterManager] FATAL: Identity mismatch for cached adapter. ` +
          `Reason: ${cachedIdentityMismatch}. CacheKey: ${cacheKey}`,
      });
    }

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
      cacheKey,
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
      cacheKey,
      projectSlug,
      productionMode,
      releaseId,
      environmentName,
      sourceType: context.sourceType,
      contextReleaseId: "releaseId" in context ? context.releaseId : "N/A",
    });

    adapter.setContentContext(context);

    const projectAdapter: ProjectAdapter = { adapter, lastAccessed: Date.now(), identity };

    const initPromise = (async (): Promise<VeryfrontFSAdapter> => {
      const initStartTime = performance.now();

      logger.debug("Adapter initialization START", {
        cacheKey,
        projectSlug,
      });

      projectAdapter.initializing = adapter.initialize();

      try {
        await projectAdapter.initializing;

        logger.debug("Adapter initialization DONE", {
          cacheKey,
          projectSlug,
          duration: `${(performance.now() - initStartTime).toFixed(2)}ms`,
        });

        this.adapters.set(cacheKey, projectAdapter);
        return adapter;
      } catch (error) {
        logger.error("Adapter initialization failed", {
          cacheKey,
          projectSlug,
          duration: `${(performance.now() - initStartTime).toFixed(2)}ms`,
          error: error instanceof Error ? error.message : String(error),
        });

        throw error;
      } finally {
        projectAdapter.initializing = undefined;
        this.pendingAdapters.delete(cacheKey);
      }
    })();

    this.pendingAdapters.set(cacheKey, initPromise);
    return initPromise;
  }

  private evictLeastRecentlyUsed(): void {
    let oldestCacheKey: string | null = null;
    let oldestTime = Infinity;

    for (const [cacheKey, adapter] of this.adapters) {
      if (adapter.lastAccessed < oldestTime) {
        oldestCacheKey = cacheKey;
        oldestTime = adapter.lastAccessed;
      }
    }

    if (!oldestCacheKey) return;

    logger.debug("Evicting LRU adapter", { cacheKey: oldestCacheKey });

    const adapter = this.adapters.get(oldestCacheKey);
    if (!adapter) return;

    adapter.adapter.dispose();
    this.adapters.delete(oldestCacheKey);
  }

  private cleanupIdleAdapters(): void {
    const now = Date.now();

    for (const [cacheKey, adapter] of this.adapters) {
      if (now - adapter.lastAccessed <= this.maxIdleMs) continue;

      logger.debug("Removing idle adapter", { cacheKey });
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
    logger.debug("Evicting adapter", { cacheKey });
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

    for (const [cacheKey, adapter] of this.adapters) {
      stats[cacheKey] = adapter.adapter.getCacheStats();
    }

    return { adapters: this.adapters.size, stats };
  }

  dispose(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }

    for (const [cacheKey, adapter] of this.adapters) {
      logger.debug("Disposing adapter", { cacheKey });
      adapter.adapter.dispose();
    }

    this.adapters.clear();
    logger.debug("Disposed");
  }
}
