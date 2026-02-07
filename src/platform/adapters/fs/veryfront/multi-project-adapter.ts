import { AsyncLocalStorage } from "node:async_hooks";
import { logger } from "#veryfront/utils";
import type { DirectoryEntry, FSAdapter, FSAdapterConfig } from "./types.ts";
import type { FileInfo } from "../../base.ts";
import { ProxyFSAdapterManager } from "./proxy-manager.ts";
import type { VeryfrontFSAdapter } from "./index.ts";
import { runWithCacheBatching } from "../../../../cache/request-cache-batcher.ts";

interface RequestContext {
  projectSlug: string;
  projectId?: string;
  token: string;
  productionMode: boolean;
  /** Release ID for production mode (mutually exclusive with branch) */
  releaseId?: string | null;
  /** Branch name for preview mode (mutually exclusive with releaseId) */
  branch?: string | null;
  /** Actual environment name from API (e.g., "Development", "Production") */
  environmentName?: string | null;
  /**
   * Request-scoped file content cache.
   * Deduplicates file fetches within a single HTTP request.
   * This is especially important in preview mode where the persistent cache is disabled.
   */
  fileCache?: Map<string, string>;
}

const asyncLocalStorage = new AsyncLocalStorage<RequestContext>();

export class MultiProjectFSAdapter implements FSAdapter {
  private manager: ProxyFSAdapterManager;
  private defaultAdapter?: VeryfrontFSAdapter;

  constructor(config: FSAdapterConfig) {
    this.manager = new ProxyFSAdapterManager({
      baseConfig: config,
      maxAdapters: 100,
      cleanupIntervalMs: 5 * 60 * 1000,
      maxIdleMs: 30 * 60 * 1000,
    });

    logger.debug("[MultiProjectFSAdapter] Created", {
      proxyMode: config.veryfront?.proxyMode,
    });
  }

  runWithContext<T>(
    projectSlug: string,
    token: string,
    fn: () => Promise<T>,
    projectId?: string,
    options?: {
      productionMode?: boolean;
      releaseId?: string | null;
      branch?: string | null;
      environmentName?: string | null;
    },
  ): Promise<T> {
    const startTime = performance.now();
    const productionMode = options?.productionMode ?? false;
    const releaseId = options?.releaseId ?? null;
    const branch = options?.branch ?? null;
    const environmentName = options?.environmentName ?? null;

    logger.debug("[MultiProjectFSAdapter] runWithContext START", {
      projectSlug,
      hasToken: !!token,
      productionMode,
      releaseId: productionMode ? releaseId : undefined,
      branch: productionMode ? undefined : branch,
      environmentName,
    });

    const context: RequestContext = {
      projectSlug,
      projectId,
      token,
      productionMode,
      releaseId: productionMode ? releaseId : null,
      branch: productionMode ? null : branch,
      environmentName,
      fileCache: new Map<string, string>(),
    };

    logger.debug("[MultiProjectFSAdapter] asyncLocalStorage.run START", { projectSlug });

    return asyncLocalStorage.run(context, async () => {
      logger.debug("[MultiProjectFSAdapter] Inside asyncLocalStorage.run callback", {
        projectSlug,
        duration: `${(performance.now() - startTime).toFixed(2)}ms`,
      });

      const result = await runWithCacheBatching(fn);

      logger.debug("[MultiProjectFSAdapter] runWithContext callback complete", {
        projectSlug,
        totalDuration: `${(performance.now() - startTime).toFixed(2)}ms`,
      });

      return result;
    });
  }

  setRequestContext(projectSlug: string, token: string): void {
    const store = asyncLocalStorage.getStore();
    if (!store) return;

    store.projectSlug = projectSlug;
    store.token = token;
  }

  setProductionMode(_enabled: boolean, _releaseId?: string | null): void {
    // No-op: In proxy mode, productionMode/releaseId are passed via runWithContext().
  }

  private async getAdapter(): Promise<VeryfrontFSAdapter> {
    const startTime = performance.now();
    const context = asyncLocalStorage.getStore();

    if (!context) {
      logger.debug("[MultiProjectFSAdapter] No context available", {
        hasDefaultAdapter: !!this.defaultAdapter,
      });

      if (this.defaultAdapter) return this.defaultAdapter;

      throw new Error(
        "[MultiProjectFSAdapter] No request context available. " +
          "Use runWithContext() to set project context before accessing files.",
      );
    }

    const productionMode = context.productionMode ?? false;
    const releaseId = context.releaseId ?? null;
    const environmentName = context.environmentName ?? null;

    logger.debug("[MultiProjectFSAdapter] getAdapter RELEASE_ID_CHECK", {
      projectSlug: context.projectSlug,
      productionMode,
      releaseId,
      environmentName,
      branch: context.branch,
      hasReleaseId: !!releaseId,
    });

    const adapter = await this.manager.getAdapter(
      context.projectSlug,
      context.token,
      context.projectId,
      productionMode,
      releaseId,
      environmentName,
      context.branch,
    );

    logger.debug("[MultiProjectFSAdapter] getAdapter DONE", {
      projectSlug: context.projectSlug,
      duration: `${(performance.now() - startTime).toFixed(2)}ms`,
    });

    return adapter;
  }

  setDefaultAdapter(adapter: VeryfrontFSAdapter): void {
    this.defaultAdapter = adapter;
  }

  initialize(): Promise<void> {
    logger.debug("[MultiProjectFSAdapter] Initialized (lazy per-project initialization)");
    return Promise.resolve();
  }

  async readFile(path: string): Promise<string> {
    const adapter = await this.getAdapter();
    return adapter.readFile(path);
  }

  async readTextFile(path: string): Promise<string> {
    const adapter = await this.getAdapter();
    return adapter.readTextFile(path);
  }

  async exists(path: string): Promise<boolean> {
    const adapter = await this.getAdapter();
    return adapter.exists(path);
  }

  async stat(path: string): Promise<FileInfo> {
    const adapter = await this.getAdapter();
    return adapter.stat(path);
  }

  async readdir(path: string): Promise<DirectoryEntry[]> {
    const adapter = await this.getAdapter();
    return adapter.readdir(path);
  }

  /**
   * AsyncIterable version of readdir for compatibility with discovery code.
   * Wraps the Promise-based readdir to yield entries one at a time.
   */
  async *readDir(path: string): AsyncIterable<DirectoryEntry> {
    const entries = await this.readdir(path);
    for (const entry of entries) {
      yield entry;
    }
  }

  async resolveFile(basePath: string): Promise<string | null> {
    const adapter = await this.getAdapter();
    return adapter.resolveFile(basePath);
  }

  dispose(): void {
    this.manager.dispose();
    this.defaultAdapter?.dispose();
    this.defaultAdapter = undefined;
    logger.debug("[MultiProjectFSAdapter] Disposed");
  }

  getManagerStats(): ReturnType<ProxyFSAdapterManager["getStats"]> {
    return this.manager.getStats();
  }

  async getProjectData(): Promise<ReturnType<VeryfrontFSAdapter["getProjectData"]> | undefined> {
    try {
      const adapter = await this.getAdapter();
      return adapter.getProjectData?.();
    } catch {
      return undefined;
    }
  }

  async getFilePathByEntityId(entityId: string): Promise<string | undefined> {
    try {
      const adapter = await this.getAdapter();
      return adapter.getFilePathByEntityId?.(entityId);
    } catch {
      return undefined;
    }
  }

  async getAllSourceFiles(): Promise<Array<{ path: string; content?: string }>> {
    try {
      const adapter = await this.getAdapter();
      const files = (await adapter.getAllSourceFiles?.()) ?? [];

      if (files.length === 0) {
        logger.debug("[MultiProjectFSAdapter] getAllSourceFiles returned empty", {
          hasAdapter: !!adapter,
          hasMethod: typeof adapter.getAllSourceFiles === "function",
        });
      }

      return files;
    } catch (error) {
      logger.warn("[MultiProjectFSAdapter] getAllSourceFiles failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }
}

export function isMultiProjectAdapter(adapter: unknown): adapter is MultiProjectFSAdapter {
  return adapter instanceof MultiProjectFSAdapter;
}

export function getCurrentRequestContext(): RequestContext | null {
  return asyncLocalStorage.getStore() ?? null;
}

export function getRequestScopedFile(cacheKey: string): string | undefined {
  return asyncLocalStorage.getStore()?.fileCache?.get(cacheKey);
}

export function setRequestScopedFile(cacheKey: string, content: string): void {
  asyncLocalStorage.getStore()?.fileCache?.set(cacheKey, content);
}

/**
 * Run a function within a request context.
 * Standalone version that doesn't require an adapter instance.
 * Used by workflow workers and other components that need to establish context.
 */
export function runWithRequestContext<T>(
  options: {
    projectSlug: string;
    token: string;
    projectId?: string;
    productionMode?: boolean;
    releaseId?: string | null;
  },
  fn: () => Promise<T>,
): Promise<T> {
  const context: RequestContext = {
    projectSlug: options.projectSlug,
    projectId: options.projectId,
    token: options.token,
    productionMode: options.productionMode ?? false,
    releaseId: options.releaseId ?? null,
    fileCache: new Map<string, string>(),
  };
  return asyncLocalStorage.run(context, fn);
}

export type { RequestContext };

// Register globally for lazy access from cache-key-builder to avoid circular dependency
// deno-lint-ignore no-explicit-any
(globalThis as any).__vf_multi_project_adapter = {
  getCurrentRequestContext,
  getRequestScopedFile,
  setRequestScopedFile,
};
