import { logger as baseLogger } from "#veryfront/utils/logger/logger.ts";
import { INITIALIZATION_ERROR } from "#veryfront/errors/error-registry.ts";
import type {
  DirectoryEntry,
  FSAdapter,
  FSAdapterConfig,
  StyleArtifactAccess,
  StyleConfigBinding,
} from "./types.ts";
import type { FileInfo, ResolveFileOptions } from "../../base.ts";
import { ProxyFSAdapterManager } from "./proxy-manager.ts";
import type { VeryfrontFSAdapter } from "./adapter.ts";
import { runWithCacheBatching } from "#veryfront/cache/request-cache-batcher.ts";
import {
  clearRequestScopedFileCache,
  getCurrentRequestContext,
  type RequestTokenProvenance,
  runWithRequestContext,
} from "./request-context.ts";
import { getVeryfrontFSAdapterKind, VERYFRONT_FS_ADAPTER_KIND } from "./adapter-kind.ts";
export {
  clearRequestScopedFileCache,
  getCurrentRequestContext,
  getRequestScopedFile,
  runWithRequestContext,
  setRequestScopedFile,
  wrapWithCurrentContext,
} from "./request-context.ts";
export type { RequestContext } from "./request-context.ts";

const logger = baseLogger.component("multi-project-fs-adapter");

const IntrinsicAggregateError = AggregateError;
const IntrinsicPerformance = performance;
const NumberPrototypeToFixed = Number.prototype.toFixed;
const PerformanceNow = IntrinsicPerformance.now;
const ReflectApply = Reflect.apply;

const DEFAULT_MAX_ADAPTERS = 100;
const DEFAULT_CLEANUP_INTERVAL_MS = 5 * 60 * 1_000;
const DEFAULT_MAX_IDLE_MS = 30 * 60 * 1_000;

function monotonicNow(): number {
  return ReflectApply(PerformanceNow, IntrinsicPerformance, []) as number;
}

function formatDurationSince(startTime: number): string {
  const duration = monotonicNow() - startTime;
  return `${ReflectApply(NumberPrototypeToFixed, duration, [2]) as string}ms`;
}

export class MultiProjectFSAdapter implements FSAdapter {
  readonly symlinkSemantics = "none" as const;
  readonly [VERYFRONT_FS_ADAPTER_KIND] = "multi-project" as const;
  private manager: ProxyFSAdapterManager;
  private defaultAdapter?: VeryfrontFSAdapter;

  constructor(config: FSAdapterConfig) {
    this.manager = new ProxyFSAdapterManager({
      baseConfig: config,
      maxAdapters: DEFAULT_MAX_ADAPTERS,
      cleanupIntervalMs: DEFAULT_CLEANUP_INTERVAL_MS,
      maxIdleMs: DEFAULT_MAX_IDLE_MS,
    });

    logger.debug("Created", {
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
      tokenProvenance?: RequestTokenProvenance;
    },
  ): Promise<T> {
    const startTime = monotonicNow();
    const productionMode = options?.productionMode ?? false;
    const releaseId = options?.releaseId ?? null;
    const branch = options?.branch ?? null;
    const environmentName = options?.environmentName ?? null;

    logger.debug("runWithContext START", {
      projectSlug,
      hasToken: !!token,
      productionMode,
      releaseId: productionMode ? releaseId : undefined,
      branch: productionMode ? undefined : branch,
      environmentName,
    });

    logger.debug("asyncLocalStorage.run START", { projectSlug });

    return runWithRequestContext(
      {
        projectSlug,
        projectId,
        token,
        productionMode,
        releaseId: productionMode ? releaseId : null,
        branch,
        environmentName,
        tokenProvenance: options?.tokenProvenance,
      },
      async () => {
        logger.debug("Inside asyncLocalStorage.run callback", {
          projectSlug,
          duration: formatDurationSince(startTime),
        });

        // Release asset manifest fetchers are registered by the concrete adapter.
        // Materialize it before renderers can ask for the manifest on a first hit.
        if (productionMode && releaseId) {
          await this.getAdapter();
        }

        const result = await runWithCacheBatching(fn);

        logger.debug("runWithContext callback complete", {
          projectSlug,
          totalDuration: formatDurationSince(startTime),
        });

        return result;
      },
    );
  }

  setRequestContext(projectSlug: string, token: string): void {
    const store = getCurrentRequestContext();
    if (!store) return;

    store.projectSlug = projectSlug;
    store.token = token;
    store.requestApiCredential = undefined;
    store.cacheApiCredential = undefined;
  }

  setProductionMode(_enabled: boolean, _releaseId?: string | null): void {
    // No-op: In proxy mode, productionMode/releaseId are passed via runWithContext().
  }

  async createStyleConfigBinding(): Promise<StyleConfigBinding> {
    const adapter = await this.getAdapter();
    return adapter.createStyleConfigBinding();
  }

  async installStyleConfig(
    binding: StyleConfigBinding,
    config: Readonly<object>,
  ): Promise<boolean> {
    const adapter = await this.getAdapter();
    return adapter.installStyleConfig(binding, config);
  }

  async getStyleArtifactAccess(): Promise<StyleArtifactAccess> {
    const adapter = await this.getAdapter();
    return await adapter.getStyleArtifactAccess();
  }

  private async getAdapter(): Promise<VeryfrontFSAdapter> {
    const startTime = monotonicNow();
    const context = getCurrentRequestContext();

    if (!context) {
      logger.debug("No context available", {
        hasDefaultAdapter: !!this.defaultAdapter,
      });

      if (this.defaultAdapter) return this.defaultAdapter;

      throw INITIALIZATION_ERROR.create({
        detail: "[MultiProjectFSAdapter] No request context available. " +
          "Use runWithContext() to set project context before accessing files.",
      });
    }

    const productionMode = context.productionMode ?? false;
    const releaseId = context.releaseId ?? null;
    const environmentName = context.environmentName ?? null;

    logger.debug("getAdapter RELEASE_ID_CHECK", {
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

    logger.debug("getAdapter DONE", {
      projectSlug: context.projectSlug,
      duration: formatDurationSince(startTime),
    });

    return adapter;
  }

  setDefaultAdapter(adapter: VeryfrontFSAdapter): void {
    this.defaultAdapter = adapter;
  }

  initialize(): Promise<void> {
    logger.debug("Initialized (lazy per-project initialization)");
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

  async readOptionalTextFile(path: string): Promise<string> {
    const adapter = await this.getAdapter();
    return adapter.readOptionalTextFile(path);
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

  async resolveFile(
    basePath: string,
    options?: ResolveFileOptions,
  ): Promise<string | null> {
    const adapter = await this.getAdapter();
    return adapter.resolveFile(basePath, options);
  }

  async refreshSourceSnapshot(reason?: string): Promise<void> {
    const adapter = await this.getAdapter();
    await adapter.refreshSourceSnapshot(reason);
    const cleared = clearRequestScopedFileCache();
    if (cleared > 0) {
      logger.debug("Cleared request-scoped file cache after source snapshot refresh", {
        reason,
        cleared,
      });
    }
  }

  async ensureSourceSnapshotFresh(reason?: string): Promise<void> {
    const adapter = await this.getAdapter();
    if (typeof adapter.ensureSourceSnapshotFresh !== "function") return;

    const previousVersion = await adapter.getSourceSnapshotVersion?.();
    await adapter.ensureSourceSnapshotFresh(reason);
    const currentVersion = await adapter.getSourceSnapshotVersion?.();
    const sourceMayHaveChanged = previousVersion === undefined ||
      currentVersion === undefined ||
      previousVersion !== currentVersion;
    if (!sourceMayHaveChanged) return;

    const cleared = clearRequestScopedFileCache();
    if (cleared > 0) {
      logger.debug("Cleared request-scoped file cache after source freshness changed", {
        reason,
        cleared,
        previousVersion,
        currentVersion,
      });
    }
  }

  async getSourceSnapshotVersion(): Promise<number | undefined> {
    const adapter = await this.getAdapter();
    return typeof adapter.getSourceSnapshotVersion === "function"
      ? await adapter.getSourceSnapshotVersion()
      : undefined;
  }

  dispose(): void {
    let managerError: unknown;
    let managerFailed = false;
    try {
      this.manager.dispose();
    } catch (error) {
      managerError = error;
      managerFailed = true;
    }

    let defaultAdapterError: unknown;
    let defaultAdapterFailed = false;
    const defaultAdapter = this.defaultAdapter;
    try {
      defaultAdapter?.dispose();
    } catch (error) {
      defaultAdapterError = error;
      defaultAdapterFailed = true;
    } finally {
      this.defaultAdapter = undefined;
    }

    if (managerFailed && defaultAdapterFailed) {
      throw new IntrinsicAggregateError(
        [managerError, defaultAdapterError],
        "Multiple filesystem adapters failed to dispose",
      );
    }
    if (managerFailed) throw managerError;
    if (defaultAdapterFailed) throw defaultAdapterError;

    logger.debug("Disposed");
  }

  getManagerStats(): ReturnType<ProxyFSAdapterManager["getStats"]> {
    return this.manager.getStats();
  }

  async getProjectData(): Promise<ReturnType<VeryfrontFSAdapter["getProjectData"]> | undefined> {
    try {
      const adapter = await this.getAdapter();
      return adapter.getProjectData?.();
    } catch (error) {
      logger.debug("getProjectData failed", { error });
      return undefined;
    }
  }

  async getFilePathByEntityId(entityId: string): Promise<string | undefined> {
    try {
      const adapter = await this.getAdapter();
      return adapter.getFilePathByEntityId?.(entityId);
    } catch (error) {
      logger.debug("getFilePathByEntityId failed", { entityId, error });
      return undefined;
    }
  }

  async getAllSourceFiles(): Promise<Array<{ path: string; content?: string }>> {
    try {
      const adapter = await this.getAdapter();
      const files = (await adapter.getAllSourceFiles?.()) ?? [];

      if (files.length === 0) {
        logger.debug("getAllSourceFiles returned empty", {
          hasAdapter: !!adapter,
          hasMethod: typeof adapter.getAllSourceFiles === "function",
        });
      }

      return files;
    } catch (error) {
      logger.warn("getAllSourceFiles failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }
}

export function isMultiProjectAdapter(adapter: unknown): adapter is MultiProjectFSAdapter {
  return getVeryfrontFSAdapterKind(adapter) === "multi-project";
}
