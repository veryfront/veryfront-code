import { logger } from "#veryfront/utils";
import { buildProxyManagerCacheKey } from "#veryfront/cache";
import { z } from "zod";
import { VeryfrontFSAdapter } from "./index.ts";
import type { CacheStats, FSAdapterConfig, ResolvedContentContext } from "./types.ts";
import { ReloadNotifier } from "../../../../server/reload-notifier.ts";
import {
  clearSSRModuleCache,
  clearSSRModuleCacheForProject,
} from "../../../../modules/react-loader/ssr-module-loader/cache/index.ts";
import {
  clearRouterDetectionCache,
  clearRouterDetectionCacheForProject,
} from "../../../../rendering/router-detection.ts";
import {
  clearModulePathCache,
  invalidateModulePaths,
} from "../../../../transforms/mdx/esm-module-loader/cache/index.ts";
import {
  clearSnippetCache,
  clearSnippetCacheForProject,
} from "../../../../rendering/snippet-renderer.ts";
import {
  clearRendererCacheForProject,
  clearRendererCaches,
} from "../../../../rendering/renderer.ts";
import { clearDomainCache } from "../../../../server/utils/domain-lookup.ts";

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

const GetAdapterParamsSchema = z.object({
  projectSlug: z.string().min(1, "projectSlug must be non-empty"),
  token: z.string().min(1, "token must be non-empty"),
  projectId: z.string().optional(),
  productionMode: z.boolean(),
  releaseId: z.string().nullable().optional(),
  environmentName: z.string().nullable().optional(),
  branch: z.string().nullable().optional(),
});

export class ProxyFSAdapterManager {
  private adapters = new Map<string, ProjectAdapter>();
  private pendingAdapters = new Map<string, Promise<VeryfrontFSAdapter>>();
  private baseConfig: FSAdapterConfig;
  private maxAdapters: number;
  private maxIdleMs: number;
  private cleanupTimer?: ReturnType<typeof setInterval>;

  constructor(config: ProxyFSAdapterManagerConfig) {
    this.baseConfig = config.baseConfig;
    this.maxAdapters = config.maxAdapters ?? 100;
    this.maxIdleMs = config.maxIdleMs ?? 30 * 60 * 1000;

    if (config.cleanupIntervalMs) {
      this.cleanupTimer = setInterval((): void => {
        this.cleanupIdleAdapters();
      }, config.cleanupIntervalMs);
    }

    logger.debug("[ProxyFSAdapterManager] Created", {
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

    logger.debug("[ProxyFSAdapterManager] getAdapter START", {
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
      logger.error("[ProxyFSAdapterManager] Validation failed", {
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

    logger.debug("[ProxyFSAdapterManager] getAdapter called", {
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
      logger.debug("[ProxyFSAdapterManager] REUSING_CACHED_ADAPTER", {
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
      logger.debug("[ProxyFSAdapterManager] Waiting for pending adapter creation", {
        cacheKey,
        projectSlug,
      });

      const waitStartTime = performance.now();
      const adapter = await pending;

      logger.debug("[ProxyFSAdapterManager] Pending adapter ready", {
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

    logger.debug("[ProxyFSAdapterManager] Creating new adapter", {
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
      logger.error("[ProxyFSAdapterManager] Null context detected", { cacheKey });
      throw new Error(
        `[ProxyFSAdapterManager] FATAL: Cached adapter has null context. ` +
          `This indicates a critical bug in adapter initialization. ` +
          `CacheKey: ${cacheKey}`,
      );
    }

    const mismatchReason = this.getContextMismatchReason(currentContext, expected);
    if (!mismatchReason) return;

    logger.error("[ProxyFSAdapterManager] Context mismatch detected", {
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

    logger.debug("[ProxyFSAdapterManager] Creating NEW adapter", {
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
        clearRendererCache: clearRendererCaches,
        clearSSRModuleCacheForProject,
        clearRouterDetectionCacheForProject,
        clearSnippetCacheForProject,
        clearRendererCacheForProject,
        clearDomainCache,
        triggerReload: (changedPaths, project) =>
          ReloadNotifier.triggerReload(changedPaths, project),
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

    logger.info("[ProxyFSAdapterManager] CONTENT_CONTEXT_SET", {
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
      lastAccessed: Date.now(),
    };

    const initPromise = (async (): Promise<VeryfrontFSAdapter> => {
      const initStartTime = performance.now();

      logger.debug("[ProxyFSAdapterManager] Adapter initialization START", {
        cacheKey,
        projectSlug,
      });

      projectAdapter.initializing = adapter.initialize();

      try {
        await projectAdapter.initializing;

        logger.debug("[ProxyFSAdapterManager] Adapter initialization DONE", {
          cacheKey,
          projectSlug,
          duration: `${(performance.now() - initStartTime).toFixed(2)}ms`,
        });

        this.adapters.set(cacheKey, projectAdapter);
        return adapter;
      } catch (error) {
        logger.error("[ProxyFSAdapterManager] Adapter initialization failed", {
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
    let oldest: { cacheKey: string; time: number } | null = null;

    for (const [cacheKey, adapter] of this.adapters) {
      if (!oldest || adapter.lastAccessed < oldest.time) {
        oldest = { cacheKey, time: adapter.lastAccessed };
      }
    }

    if (!oldest) return;

    logger.debug("[ProxyFSAdapterManager] Evicting LRU adapter", { cacheKey: oldest.cacheKey });

    const adapter = this.adapters.get(oldest.cacheKey);
    if (!adapter) return;

    adapter.adapter.dispose();
    this.adapters.delete(oldest.cacheKey);
  }

  private cleanupIdleAdapters(): void {
    const now = Date.now();
    const toRemove: string[] = [];

    for (const [cacheKey, adapter] of this.adapters) {
      if (now - adapter.lastAccessed > this.maxIdleMs) {
        toRemove.push(cacheKey);
      }
    }

    for (const cacheKey of toRemove) {
      logger.debug("[ProxyFSAdapterManager] Removing idle adapter", { cacheKey });
      const adapter = this.adapters.get(cacheKey);
      if (!adapter) continue;

      adapter.adapter.dispose();
      this.adapters.delete(cacheKey);
    }

    if (toRemove.length) {
      logger.debug("[ProxyFSAdapterManager] Cleanup complete", {
        removed: toRemove.length,
        remaining: this.adapters.size,
      });
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
      logger.debug("[ProxyFSAdapterManager] Disposing adapter", { cacheKey });
      adapter.adapter.dispose();
    }

    this.adapters.clear();
    logger.debug("[ProxyFSAdapterManager] Disposed");
  }
}
