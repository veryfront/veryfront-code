import { logger as baseLogger } from "#veryfront/utils";
import { buildProxyManagerCacheKey } from "#veryfront/cache";
import { VeryfrontFSAdapter } from "./index.ts";
import type { CacheStats, FSAdapterConfig, ResolvedContentContext } from "./types.ts";
import {
  clearSSRModuleCache,
  clearSSRModuleCacheForProject,
} from "#veryfront/modules/react-loader/ssr-module-loader/cache/index.ts";
import {
  clearRouterDetectionCache,
  clearRouterDetectionCacheForProject,
} from "#veryfront/rendering/router-detection.ts";
import {
  clearModulePathCache,
  invalidateModulePaths,
} from "#veryfront/transforms/mdx/esm-module-loader/cache/index.ts";
import {
  clearSnippetCache,
  clearSnippetCacheForProject,
} from "#veryfront/rendering/snippet-renderer.ts";
import { clearRendererCacheForProject } from "#veryfront/rendering/renderer.ts";
import { GetAdapterParamsSchema } from "./schemas/index.ts";

const logger = baseLogger.component("proxy-fs-adapter-manager");

const DEFAULT_MAX_ADAPTERS = 100;
const DEFAULT_MAX_IDLE_MS = 30 * 60 * 1_000;

interface ProjectAdapter {
  adapter: VeryfrontFSAdapter;
  lastAccessed: number;
  initializing?: Promise<void>;
}

interface ProxyFSAdapterManagerConfig {
  baseConfig: FSAdapterConfig;
  maxAdapters?: number;
  cleanupIntervalMs?: number;
  maxIdleMs?: number;
}

export class ProxyFSAdapterManager {
  private adapters = new Map<string, ProjectAdapter>();
  private pendingAdapters = new Map<string, Promise<VeryfrontFSAdapter>>();
  private baseConfig: FSAdapterConfig;
  private maxAdapters: number;
  private maxIdleMs: number;
  private cleanupTimer?: ReturnType<typeof setInterval>;

  constructor(config: ProxyFSAdapterManagerConfig) {
    this.baseConfig = config.baseConfig;
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
    const effectiveEnvironmentName = environmentName ??
      (effectiveProductionMode ? "production" : null);
    const effectiveBranch = branch ?? (effectiveProductionMode ? null : "main");

    logger.debug("getAdapter START", {
      projectSlug,
      productionMode: effectiveProductionMode,
      releaseId: effectiveReleaseId,
      environmentName: effectiveEnvironmentName,
      branch: effectiveBranch,
    });

    const validationResult = GetAdapterParamsSchema.safeParse({
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
        errors: validationResult.error.errors,
        params: {
          projectSlug,
          productionMode: effectiveProductionMode,
          releaseId: effectiveReleaseId,
          environmentName: effectiveEnvironmentName,
          branch: effectiveBranch,
        },
      });
      throw new Error(
        `[ProxyFSAdapterManager] Invalid getAdapter parameters: ${validationResult.error.message}`,
      );
    }

    const cacheKey = buildProxyManagerCacheKey(
      projectSlug,
      effectiveProductionMode,
      effectiveReleaseId,
      effectiveBranch,
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
      existing.adapter.setRequestToken(token);

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

      logger.debug("Pending adapter ready", {
        cacheKey,
        waitDuration: `${(performance.now() - waitStartTime).toFixed(2)}ms`,
        totalDuration: `${(performance.now() - getAdapterStartTime).toFixed(2)}ms`,
      });

      adapter.setRequestToken(token);
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
    );
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
      throw new Error(
        `[ProxyFSAdapterManager] FATAL: Cached adapter has null context. ` +
          `This indicates a critical bug in adapter initialization. ` +
          `CacheKey: ${cacheKey}`,
      );
    }

    const mismatchReason = this.getContextMismatchReason(currentContext, expected);
    if (!mismatchReason) return;

    logger.error("Context mismatch detected", {
      cacheKey,
      currentContext,
      expected,
      mismatchReason,
    });

    throw new Error(
      `[ProxyFSAdapterManager] FATAL: Context mismatch for cached adapter. ` +
        `This indicates a critical bug in adapter caching. ` +
        `Reason: ${mismatchReason}. ` +
        `Expected: ${JSON.stringify(expected)} ` +
        `Got: ${JSON.stringify(currentContext)} ` +
        `CacheKey: ${cacheKey}`,
    );
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
      if (currentContext.sourceType !== "release" && currentContext.sourceType !== "environment") {
        return `Expected sourceType "release" or "environment", got "${currentContext.sourceType}"`;
      }

      if (
        currentContext.sourceType === "release" && currentContext.releaseId !== expected.releaseId
      ) {
        return `Expected releaseId "${expected.releaseId}", got "${currentContext.releaseId}"`;
      }

      if (
        currentContext.sourceType === "environment" &&
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
  ): Promise<VeryfrontFSAdapter> {
    const effectiveToken = token || this.baseConfig.veryfront?.apiToken;

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
        apiToken: effectiveToken,
      },
      invalidationCallbacks: {
        clearSSRModuleCache,
        clearRouterDetectionCache,
        clearModulePathCache,
        invalidateModulePaths,
        clearSnippetCache,
        clearSSRModuleCacheForProject,
        clearRouterDetectionCacheForProject,
        clearSnippetCacheForProject,
        clearRendererCacheForProject,
        ...this.baseConfig.invalidationCallbacks,
      },
    };

    const adapter = new VeryfrontFSAdapter(config);

    let context: ResolvedContentContext;
    if (productionMode) {
      if (releaseId) {
        context = { sourceType: "release", projectSlug, releaseId };
      } else {
        context = { sourceType: "environment", projectSlug, environmentName: environmentName! };
      }
    } else {
      context = { sourceType: "branch", projectSlug, branch: branch! };
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

    const projectAdapter: ProjectAdapter = { adapter, lastAccessed: Date.now() };

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
  ): boolean {
    const cacheKey = buildProxyManagerCacheKey(
      projectSlug,
      productionMode ?? false,
      releaseId ?? null,
      branch ?? null,
    );
    return this.adapters.has(cacheKey);
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
