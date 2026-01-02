import { AsyncLocalStorage } from "node:async_hooks";
import { logger } from "@veryfront/utils";
import type { DirectoryEntry, FSAdapter, FSAdapterConfig } from "./veryfront-fs-adapter/types.ts";
import type { FileInfo } from "./base.ts";
import { ProxyFSAdapterManager } from "./proxy-fs-adapter-manager.ts";
import type { VeryfrontFSAdapter } from "./veryfront-fs-adapter.ts";

interface RequestContext {
  projectSlug: string;
  token: string;
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

    logger.info("[MultiProjectFSAdapter] Created", {
      proxyMode: config.veryfront?.proxyMode,
    });
  }

  runWithContext<T>(
    projectSlug: string,
    token: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    return asyncLocalStorage.run({ projectSlug, token }, fn);
  }

  setRequestContext(projectSlug: string, token: string): void {
    const store = asyncLocalStorage.getStore();
    if (store) {
      store.projectSlug = projectSlug;
      store.token = token;
    }
  }

  private async getAdapter(): Promise<VeryfrontFSAdapter> {
    const context = asyncLocalStorage.getStore();

    if (!context) {
      if (this.defaultAdapter) {
        return this.defaultAdapter;
      }
      throw new Error(
        "[MultiProjectFSAdapter] No request context available. " +
          "Use runWithContext() to set project context before accessing files.",
      );
    }

    return await this.manager.getAdapter(context.projectSlug, context.token);
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
