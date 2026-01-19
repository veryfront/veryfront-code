import { logger } from "#veryfront/utils";
import { VeryfrontFSAdapter } from "./index.ts";
import type { CacheStats, FSAdapterConfig, ResolvedContentContext } from "./types.ts";
import { ReloadNotifier } from "../../../../server/reload-notifier.ts";
import { clearSSRModuleCache } from "../../../../modules/react-loader/ssr-module-loader/cache/index.ts";
import { clearRouterDetectionCache } from "../../../../rendering/router-detection.ts";
import {
  clearModulePathCache,
  invalidateModulePaths,
} from "../../../../transforms/mdx/esm-module-loader/cache/index.ts";
import { clearSnippetCache } from "../../../../rendering/snippet-renderer.ts";
import { buildProxyManagerCacheKey } from "#veryfront/cache";
import { z } from "zod";

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

// Input validation schema for getAdapter parameters
// Note: branch and environmentName can be null - they have defaults ("main" and "production")
const GetAdapterParamsSchema = z.object({
  projectSlug: z.string().min(1, "projectSlug must be non-empty"),
  token: z.string().min(1, "token must be non-empty"),
  projectId: z.string().optional(),
  productionMode: z.boolean(),
  releaseId: z.string().nullable().optional(),
  environmentName: z.string().nullable().optional(),
  branch: z.string().nullable().optional(),
});

// Use centralized buildProxyManagerCacheKey from core/cache/keys.ts

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
    this.maxIdleMs = config.maxIdleMs ?? 30 * 60 * 1000; // 30 minutes

    if (config.cleanupIntervalMs) {
      this.cleanupTimer = setInterval(() => {
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
    // Normalize productionMode - must be explicitly set
    const effectiveProductionMode = productionMode ?? false;
    const effectiveReleaseId = releaseId ?? null;
    // Apply defaults early so cache key and context verification use the same values
    const effectiveEnvironmentName = environmentName ??
      (effectiveProductionMode ? "production" : null);
    const effectiveBranch = branch ?? (effectiveProductionMode ? null : "main");

    // Validate input parameters
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
      const error = new Error(
        `[ProxyFSAdapterManager] Invalid getAdapter parameters: ${validationResult.error.message}`,
      );
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
      throw error;
    }

    // No fallback for token - validation ensures it's non-empty

    // Cache key includes productionMode, releaseId, and branch to prevent race conditions
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

      // Verify content context matches expected parameters
      // If there's a mismatch, this is a critical bug - fail fast
      const currentContext = existing.adapter.getContentContext();

      // Context must exist
      if (!currentContext) {
        const error = new Error(
          `[ProxyFSAdapterManager] FATAL: Cached adapter has null context. ` +
            `This indicates a critical bug in adapter initialization. ` +
            `CacheKey: ${cacheKey}`,
        );
        logger.error("[ProxyFSAdapterManager] Null context detected", {
          cacheKey,
        });
        throw error;
      }

      // Check if context matches expectations
      let contextMismatch = false;
      let mismatchReason = "";

      if (effectiveProductionMode) {
        // Production mode: sourceType must be "release" or "environment"
        if (
          currentContext.sourceType !== "release" && currentContext.sourceType !== "environment"
        ) {
          contextMismatch = true;
          mismatchReason =
            `Expected sourceType "release" or "environment", got "${currentContext.sourceType}"`;
        } else if (
          currentContext.sourceType === "release" && currentContext.releaseId !== effectiveReleaseId
        ) {
          contextMismatch = true;
          mismatchReason =
            `Expected releaseId "${effectiveReleaseId}", got "${currentContext.releaseId}"`;
        } else if (
          currentContext.sourceType === "environment" &&
          currentContext.environmentName !== effectiveEnvironmentName
        ) {
          contextMismatch = true;
          mismatchReason =
            `Expected environmentName "${effectiveEnvironmentName}", got "${currentContext.environmentName}"`;
        }
      } else {
        // Preview mode: sourceType must be "branch"
        if (currentContext.sourceType !== "branch") {
          contextMismatch = true;
          mismatchReason = `Expected sourceType "branch", got "${currentContext.sourceType}"`;
        } else if (currentContext.branch !== effectiveBranch) {
          contextMismatch = true;
          mismatchReason = `Expected branch "${effectiveBranch}", got "${currentContext.branch}"`;
        }
      }

      if (contextMismatch) {
        const error = new Error(
          `[ProxyFSAdapterManager] FATAL: Context mismatch for cached adapter. ` +
            `This indicates a critical bug in adapter caching. ` +
            `Reason: ${mismatchReason}. ` +
            `Expected: ${
              JSON.stringify({
                productionMode: effectiveProductionMode,
                branch: effectiveBranch,
                releaseId: effectiveReleaseId,
                environmentName: effectiveEnvironmentName,
              })
            } ` +
            `Got: ${JSON.stringify(currentContext)} ` +
            `CacheKey: ${cacheKey}`,
        );
        logger.error("[ProxyFSAdapterManager] Context mismatch detected", {
          cacheKey,
          currentContext,
          expected: {
            productionMode: effectiveProductionMode,
            branch: effectiveBranch,
            releaseId: effectiveReleaseId,
            environmentName: effectiveEnvironmentName,
          },
          mismatchReason,
        });
        throw error;
      }

      logger.debug("[ProxyFSAdapterManager] Reusing cached adapter", {
        cacheKey,
        contentContext: existing.adapter.getContentContext(),
      });

      if (existing.initializing) {
        await existing.initializing;
      }

      return existing.adapter;
    }

    // Check for pending adapter creation to prevent concurrent creation
    const pending = this.pendingAdapters.get(cacheKey);
    if (pending) {
      const adapter = await pending;
      adapter.setRequestToken(token);
      return adapter;
    }

    if (this.adapters.size >= this.maxAdapters) {
      this.evictLeastRecentlyUsed();
    }

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
      // Inject invalidationCallbacks to wire up cache clearing and HMR notifications
      // When FSAdapter receives poke from API:
      // 1. Clear all server-side caches (SSR modules, router detection, etc.)
      // 2. Trigger browser reload via ReloadNotifier → HMRHandler → WebSocket
      invalidationCallbacks: {
        clearSSRModuleCache,
        clearRouterDetectionCache,
        clearModulePathCache,
        invalidateModulePaths,
        clearSnippetCache,
        triggerReload: (changedPaths) => ReloadNotifier.triggerReload(changedPaths),
      },
    };

    const adapter = new VeryfrontFSAdapter(config);

    // Set content context based on production mode before initialization
    // Note: environmentName and branch already have defaults applied by getAdapter()
    const context: ResolvedContentContext = productionMode
      ? releaseId
        ? { sourceType: "release", projectSlug, releaseId }
        : { sourceType: "environment", projectSlug, environmentName: environmentName! }
      : { sourceType: "branch", projectSlug, branch: branch! };

    logger.debug("[ProxyFSAdapterManager] Setting content context for new adapter", {
      cacheKey,
      projectSlug,
      productionMode,
      releaseId,
      environmentName,
      branch,
      context,
    });

    adapter.setContentContext(context);

    const projectAdapter: ProjectAdapter = {
      adapter,
      lastAccessed: Date.now(),
    };

    // Store in pending map to prevent concurrent creation
    const initPromise = (async () => {
      projectAdapter.initializing = adapter.initialize();
      try {
        await projectAdapter.initializing;
        logger.debug("[ProxyFSAdapterManager] Adapter initialized", { cacheKey });
        this.adapters.set(cacheKey, projectAdapter);
      } finally {
        projectAdapter.initializing = undefined;
        this.pendingAdapters.delete(cacheKey);
      }
      return adapter;
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

    if (oldest) {
      logger.debug("[ProxyFSAdapterManager] Evicting LRU adapter", { cacheKey: oldest.cacheKey });
      const adapter = this.adapters.get(oldest.cacheKey);
      if (adapter) {
        adapter.adapter.dispose();
        this.adapters.delete(oldest.cacheKey);
      }
    }
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
      if (adapter) {
        adapter.adapter.dispose();
        this.adapters.delete(cacheKey);
      }
    }

    if (toRemove.length > 0) {
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

    return {
      adapters: this.adapters.size,
      stats,
    };
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
