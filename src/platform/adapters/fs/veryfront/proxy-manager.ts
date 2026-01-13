import { logger } from "@veryfront/utils";
import { VeryfrontFSAdapter } from "./index.ts";
import type { CacheStats, FSAdapterConfig, ResolvedContentContext } from "./types.ts";
import { ReloadNotifier } from "../../../../server/reload-notifier.ts";

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

/**
 * Generate cache key for adapter lookup.
 * Includes productionMode and releaseId to prevent race conditions between
 * concurrent requests with different modes/releases.
 */
function buildCacheKey(
  projectSlug: string,
  productionMode: boolean,
  releaseId: string | null,
): string {
  if (productionMode) {
    return `${projectSlug}:production:${releaseId ?? "latest"}`;
  }
  return `${projectSlug}:preview`;
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
    this.maxAdapters = config.maxAdapters ?? 100;
    this.maxIdleMs = config.maxIdleMs ?? 30 * 60 * 1000; // 30 minutes

    if (config.cleanupIntervalMs) {
      this.cleanupTimer = setInterval(() => {
        this.cleanupIdleAdapters();
      }, config.cleanupIntervalMs);
    }

    logger.info("[ProxyFSAdapterManager] Created", {
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
  ): Promise<VeryfrontFSAdapter> {
    const effectiveToken = token || this.baseConfig.veryfront?.apiToken || "";
    const effectiveProductionMode = productionMode ?? false;
    const effectiveReleaseId = releaseId ?? null;

    // Cache key includes productionMode and releaseId to prevent race conditions
    const cacheKey = buildCacheKey(projectSlug, effectiveProductionMode, effectiveReleaseId);
    const existing = this.adapters.get(cacheKey);

    if (existing) {
      existing.lastAccessed = Date.now();
      existing.adapter.setRequestToken(effectiveToken);

      logger.debug("[ProxyFSAdapterManager] Reusing cached adapter", {
        cacheKey,
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
      adapter.setRequestToken(effectiveToken);
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
    );
  }

  private createAdapter(
    cacheKey: string,
    projectSlug: string,
    token: string,
    projectId: string | undefined,
    productionMode: boolean,
    releaseId: string | null,
  ): Promise<VeryfrontFSAdapter> {
    const effectiveToken = token || this.baseConfig.veryfront?.apiToken;

    logger.debug("[ProxyFSAdapterManager] Creating adapter", {
      cacheKey,
      projectSlug,
    });

    const config: FSAdapterConfig = {
      ...this.baseConfig,
      veryfront: {
        ...this.baseConfig.veryfront,
        projectSlug,
        projectId,
        apiToken: effectiveToken,
      },
      // Inject invalidationCallbacks to wire up HMR notifications
      // When FSAdapter receives poke from API, it calls triggerReload
      // which notifies HMRHandler to broadcast to connected browsers
      invalidationCallbacks: {
        triggerReload: (changedPaths) => ReloadNotifier.triggerReload(changedPaths),
      },
    };

    const adapter = new VeryfrontFSAdapter(config);

    // Set content context based on production mode before initialization
    const context: ResolvedContentContext = productionMode
      ? releaseId
        ? { sourceType: "release", projectSlug, releaseId }
        : { sourceType: "environment", projectSlug, environmentName: "production" }
      : { sourceType: "branch", projectSlug, branch: "main" };
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
      logger.info("[ProxyFSAdapterManager] Evicting LRU adapter", { cacheKey: oldest.cacheKey });
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
      logger.info("[ProxyFSAdapterManager] Removing idle adapter", { cacheKey });
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

  hasAdapter(projectSlug: string, productionMode?: boolean, releaseId?: string | null): boolean {
    const cacheKey = buildCacheKey(projectSlug, productionMode ?? false, releaseId ?? null);
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
      logger.info("[ProxyFSAdapterManager] Disposing adapter", { cacheKey });
      adapter.adapter.dispose();
    }

    this.adapters.clear();
    logger.info("[ProxyFSAdapterManager] Disposed");
  }
}
