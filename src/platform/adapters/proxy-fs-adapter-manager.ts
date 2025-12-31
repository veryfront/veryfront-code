import { logger } from "@veryfront/utils";
import { VeryfrontFSAdapter } from "./veryfront-fs-adapter.ts";
import type { FSAdapterConfig, CacheStats } from "./veryfront-fs-adapter/types.ts";

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

  async getAdapter(projectSlug: string, token: string): Promise<VeryfrontFSAdapter> {
    const existing = this.adapters.get(projectSlug);

    if (existing) {
      existing.lastAccessed = Date.now();
      existing.adapter.setRequestToken(token);

      if (existing.initializing) {
        await existing.initializing;
      }

      return existing.adapter;
    }

    // Check for pending adapter creation to prevent concurrent creation
    const pending = this.pendingAdapters.get(projectSlug);
    if (pending) {
      const adapter = await pending;
      adapter.setRequestToken(token);
      return adapter;
    }

    if (this.adapters.size >= this.maxAdapters) {
      this.evictLeastRecentlyUsed();
    }

    return this.createAdapter(projectSlug, token);
  }

  private async createAdapter(projectSlug: string, token: string): Promise<VeryfrontFSAdapter> {
    logger.info("[ProxyFSAdapterManager] Creating adapter for project", { projectSlug });

    const config: FSAdapterConfig = {
      ...this.baseConfig,
      veryfront: {
        ...this.baseConfig.veryfront,
        projectSlug,
        apiToken: token,
      },
    };

    const adapter = new VeryfrontFSAdapter(config);

    const projectAdapter: ProjectAdapter = {
      adapter,
      lastAccessed: Date.now(),
    };

    // Store in pending map to prevent concurrent creation
    const initPromise = (async () => {
      projectAdapter.initializing = adapter.initialize();
      try {
        await projectAdapter.initializing;
        logger.info("[ProxyFSAdapterManager] Adapter initialized", { projectSlug });
        this.adapters.set(projectSlug, projectAdapter);
      } catch (error) {
        throw error;
      } finally {
        projectAdapter.initializing = undefined;
        this.pendingAdapters.delete(projectSlug);
      }
      return adapter;
    })();

    this.pendingAdapters.set(projectSlug, initPromise);

    return initPromise;
  }

  private evictLeastRecentlyUsed(): void {
    let oldest: { slug: string; time: number } | null = null;

    for (const [slug, adapter] of this.adapters) {
      if (!oldest || adapter.lastAccessed < oldest.time) {
        oldest = { slug, time: adapter.lastAccessed };
      }
    }

    if (oldest) {
      logger.info("[ProxyFSAdapterManager] Evicting LRU adapter", { projectSlug: oldest.slug });
      const adapter = this.adapters.get(oldest.slug);
      if (adapter) {
        adapter.adapter.dispose();
        this.adapters.delete(oldest.slug);
      }
    }
  }

  private cleanupIdleAdapters(): void {
    const now = Date.now();
    const toRemove: string[] = [];

    for (const [slug, adapter] of this.adapters) {
      if (now - adapter.lastAccessed > this.maxIdleMs) {
        toRemove.push(slug);
      }
    }

    for (const slug of toRemove) {
      logger.info("[ProxyFSAdapterManager] Removing idle adapter", { projectSlug: slug });
      const adapter = this.adapters.get(slug);
      if (adapter) {
        adapter.adapter.dispose();
        this.adapters.delete(slug);
      }
    }

    if (toRemove.length > 0) {
      logger.info("[ProxyFSAdapterManager] Cleanup complete", {
        removed: toRemove.length,
        remaining: this.adapters.size,
      });
    }
  }

  hasAdapter(projectSlug: string): boolean {
    return this.adapters.has(projectSlug);
  }

  getStats(): { adapters: number; stats: Record<string, CacheStats> } {
    const stats: Record<string, CacheStats> = {};

    for (const [slug, adapter] of this.adapters) {
      stats[slug] = adapter.adapter.getCacheStats();
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

    for (const [slug, adapter] of this.adapters) {
      logger.info("[ProxyFSAdapterManager] Disposing adapter", { projectSlug: slug });
      adapter.adapter.dispose();
    }

    this.adapters.clear();
    logger.info("[ProxyFSAdapterManager] Disposed");
  }
}
