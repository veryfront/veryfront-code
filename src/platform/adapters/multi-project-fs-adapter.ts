import { AsyncLocalStorage } from "node:async_hooks";
import { logger } from "@veryfront/utils";
import type { DirectoryEntry, FSAdapter, FSAdapterConfig } from "./veryfront-fs-adapter/types.ts";
import type { FileInfo } from "./base.ts";
import { ProxyFSAdapterManager } from "./proxy-fs-adapter-manager.ts";
import type { VeryfrontFSAdapter } from "./veryfront-fs-adapter.ts";

interface RequestContext {
  projectSlug: string;
  projectId?: string;
  token: string;
  productionMode: boolean;
  releaseId?: string | null;
}

interface RunWithContextOptions {
  projectSlug: string;
  token: string;
  projectId?: string;
  productionMode?: boolean;
  releaseId?: string | null;
}

const asyncLocalStorage = new AsyncLocalStorage<RequestContext>();

export class MultiProjectFSAdapter implements FSAdapter {
  private manager: ProxyFSAdapterManager;
  private defaultAdapter?: VeryfrontFSAdapter;
  private productionMode = false;
  private releaseId: string | null = null;

  constructor(config: FSAdapterConfig) {
    this.manager = new ProxyFSAdapterManager({
      baseConfig: config,
      maxAdapters: 100,
      cleanupIntervalMs: 5 * 60 * 1000,
      maxIdleMs: 30 * 60 * 1000,
    });

    logger.info("[MultiProjectFSAdapter] Created", {
      proxyMode: config.veryfront?.proxyMode,
    });
  }

  runWithContext<T>(
    projectSlug: string,
    token: string,
    fn: () => Promise<T>,
    projectId?: string,
    options?: { productionMode?: boolean; releaseId?: string | null },
  ): Promise<T> {
    const productionMode = options?.productionMode ?? false;
    const releaseId = options?.releaseId ?? null;

    logger.debug("[MultiProjectFSAdapter] runWithContext", {
      projectSlug,
      hasToken: !!token,
      productionMode,
    });

    // Store production mode in context so getAdapter can use it
    const context: RequestContext = {
      projectSlug,
      projectId,
      token,
      productionMode,
      releaseId,
    };

    return asyncLocalStorage.run(context, fn);
  }

  setRequestContext(projectSlug: string, token: string): void {
    const store = asyncLocalStorage.getStore();
    if (store) {
      store.projectSlug = projectSlug;
      store.token = token;
    }
  }

  setProductionMode(enabled: boolean, releaseId?: string | null): void {
    this.productionMode = enabled;
    this.releaseId = releaseId ?? null;

    // Apply to all existing cached adapters
    this.manager.setProductionModeAll(enabled, releaseId);

    logger.info("[MultiProjectFSAdapter] Production mode set", {
      enabled,
      releaseId: releaseId ?? "(none)",
    });
  }

  private getAdapter(): Promise<VeryfrontFSAdapter> {
    const context = asyncLocalStorage.getStore();

    if (!context) {
      if (this.defaultAdapter) {
        return Promise.resolve(this.defaultAdapter);
      }
      return Promise.reject(
        new Error(
          "[MultiProjectFSAdapter] No request context available. " +
            "Use runWithContext() to set project context before accessing files.",
        ),
      );
    }

    // Use production mode from context (set by runWithContext)
    // Fall back to class-level setting for backward compatibility
    const productionMode = context.productionMode ?? this.productionMode;
    const releaseId = context.releaseId ?? this.releaseId;

    // Debug level - this is called on every filesystem operation
    logger.debug("[MultiProjectFSAdapter] getAdapter", {
      projectSlug: context.projectSlug,
      productionMode,
    });

    return this.manager.getAdapter(
      context.projectSlug,
      context.token,
      context.projectId,
      productionMode,
      releaseId,
    );
  }

  setDefaultAdapter(adapter: VeryfrontFSAdapter): void {
    this.defaultAdapter = adapter;
  }

  initialize(): Promise<void> {
    logger.info("[MultiProjectFSAdapter] Initialized (lazy per-project initialization)");
    return Promise.resolve();
  }

  async readFile(path: string): Promise<Uint8Array> {
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

  async resolveFile(basePath: string): Promise<string | null> {
    const adapter = await this.getAdapter();
    return adapter.resolveFile(basePath);
  }

  dispose(): void {
    this.manager.dispose();
    logger.info("[MultiProjectFSAdapter] Disposed");
  }

  getManagerStats(): ReturnType<ProxyFSAdapterManager["getStats"]> {
    return this.manager.getStats();
  }
}

export function isMultiProjectAdapter(adapter: unknown): adapter is MultiProjectFSAdapter {
  return adapter instanceof MultiProjectFSAdapter;
}
