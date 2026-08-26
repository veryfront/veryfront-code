import { logger as baseLogger } from "#veryfront/utils/logger/logger.ts";
import { INITIALIZATION_ERROR } from "#veryfront/errors/error-registry.ts";
import type { DirectoryEntry, FSAdapter, FSAdapterConfig } from "./types.ts";
import type {
  FileInfo,
  ResolveFileOptions,
  SourceSnapshotFreshnessOptions,
} from "#veryfront/platform/adapters/base.ts";
import { ProxyFSAdapterManager } from "./proxy-manager.ts";
import { VeryfrontFSAdapter } from "./adapter.ts";
import { runWithCacheBatching } from "#veryfront/cache/request-cache-batcher.ts";
import { requireBoundedFileReadLimit } from "../../bounded-file-read.ts";
import { captureByteReadCapabilities } from "../../file-system-capabilities.ts";
import {
  clearRequestScopedFileCache,
  getCurrentRequestContext,
  runWithRequestContext,
} from "./request-context.ts";
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

const DEFAULT_MAX_ADAPTERS = 100;
const DEFAULT_CLEANUP_INTERVAL_MS = 5 * 60 * 1_000;
const DEFAULT_MAX_IDLE_MS = 30 * 60 * 1_000;
const IntrinsicReflectApply = Reflect.apply;
const IntrinsicPerformance = performance;
const PerformanceNow = IntrinsicPerformance.now;
const ObjectPrototypeIsPrototypeOf = Object.prototype.isPrototypeOf;
const ProxyFSAdapterManagerPrototype = ProxyFSAdapterManager.prototype;
const ProxyFSAdapterManagerGetAdapter = ProxyFSAdapterManagerPrototype.getAdapter;
const VeryfrontFSAdapterPrototype = VeryfrontFSAdapter.prototype;
const VeryfrontFSAdapterRefreshSourceSnapshot = VeryfrontFSAdapterPrototype.refreshSourceSnapshot;
const VeryfrontFSAdapterEnsureSourceSnapshotFresh =
  VeryfrontFSAdapterPrototype.ensureSourceSnapshotFresh;
const VeryfrontFSAdapterGetSourceSnapshotVersion =
  VeryfrontFSAdapterPrototype.getSourceSnapshotVersion;
const VeryfrontFSAdapterGetSourceSnapshotFingerprint =
  VeryfrontFSAdapterPrototype.getSourceSnapshotFingerprint;
const VeryfrontFSAdapterGetSourceSnapshotIdentity =
  VeryfrontFSAdapterPrototype.getSourceSnapshotIdentity;

function performanceNow(): number {
  return IntrinsicReflectApply(PerformanceNow, IntrinsicPerformance, []) as number;
}

function isConcreteVeryfrontFSAdapter(adapter: VeryfrontFSAdapter): boolean {
  return IntrinsicReflectApply(
    ObjectPrototypeIsPrototypeOf,
    VeryfrontFSAdapterPrototype,
    [adapter],
  ) as boolean;
}

function isConcreteProxyFSAdapterManager(manager: unknown): boolean {
  return IntrinsicReflectApply(
    ObjectPrototypeIsPrototypeOf,
    ProxyFSAdapterManagerPrototype,
    [manager],
  ) as boolean;
}

export class MultiProjectFSAdapter implements FSAdapter {
  readonly sourceSnapshotFreshnessOptionsVersion = 1 as const;
  readonly symlinkSemantics = "none" as const;
  private manager: ProxyFSAdapterManager;
  private defaultAdapter?: VeryfrontFSAdapter;
  private readonly sourceSnapshotAdapterGenerations = new WeakMap<VeryfrontFSAdapter, number>();
  private nextSourceSnapshotAdapterGeneration = 1;

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
    },
  ): Promise<T> {
    const startTime = performanceNow();
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

    return runWithRequestContext({
      projectSlug,
      projectId,
      token,
      productionMode,
      releaseId: productionMode ? releaseId : null,
      branch: productionMode ? null : branch,
      environmentName,
    }, async () => {
      logger.debug("Inside asyncLocalStorage.run callback", {
        projectSlug,
        duration: `${(performanceNow() - startTime).toFixed(2)}ms`,
      });

      // Release asset manifest fetchers are registered by the concrete adapter.
      // Materialize it before renderers can ask for the manifest on a first hit.
      if (productionMode && releaseId) {
        await this.#getAdapter();
      }

      const result = await runWithCacheBatching(fn);

      logger.debug("runWithContext callback complete", {
        projectSlug,
        totalDuration: `${(performanceNow() - startTime).toFixed(2)}ms`,
      });

      return result;
    });
  }

  setRequestContext(projectSlug: string, token: string): void {
    const store = getCurrentRequestContext();
    if (!store) return;

    store.projectSlug = projectSlug;
    store.token = token;
  }

  setProductionMode(_enabled: boolean, _releaseId?: string | null): void {
    // No-op: In proxy mode, productionMode/releaseId are passed via runWithContext().
  }

  async #getAdapter(
    onResolved?: (initializedNow: boolean) => void,
  ): Promise<VeryfrontFSAdapter> {
    const startTime = performanceNow();
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

    const args = [
      context.projectSlug,
      context.token,
      context.projectId,
      productionMode,
      releaseId,
      environmentName,
      context.branch,
      onResolved,
    ] as const;
    const adapter = isConcreteProxyFSAdapterManager(this.manager)
      ? await IntrinsicReflectApply(
        ProxyFSAdapterManagerGetAdapter,
        this.manager,
        args,
      ) as VeryfrontFSAdapter
      : await this.manager.getAdapter(...args);

    logger.debug("getAdapter DONE", {
      projectSlug: context.projectSlug,
      duration: `${(performanceNow() - startTime).toFixed(2)}ms`,
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
    const adapter = await this.#getAdapter();
    return adapter.readFile(path);
  }

  async readFileBytesWithinLimit(path: string, byteLimit: number): Promise<Uint8Array> {
    const admittedLimit = requireBoundedFileReadLimit(byteLimit);
    const adapter = await this.#getAdapter();
    const readers = captureByteReadCapabilities(
      adapter,
      "Selected Veryfront filesystem adapter",
    );
    if (readers.exact !== undefined) return readers.exact(path, admittedLimit);
    if (readers.whole !== undefined && readers.whole.maximumBytes <= admittedLimit) {
      return readers.whole.read(path);
    }
    throw new TypeError(
      `Veryfront filesystem requires an exact bounded reader or a whole-file ceiling no larger than ${admittedLimit} bytes`,
    );
  }

  async readTextFile(path: string): Promise<string> {
    const adapter = await this.#getAdapter();
    return adapter.readTextFile(path);
  }

  async readOptionalTextFile(path: string): Promise<string> {
    const adapter = await this.#getAdapter();
    return adapter.readOptionalTextFile(path);
  }

  async exists(path: string): Promise<boolean> {
    const adapter = await this.#getAdapter();
    return adapter.exists(path);
  }

  async stat(path: string): Promise<FileInfo> {
    const adapter = await this.#getAdapter();
    return adapter.stat(path);
  }

  async readdir(path: string): Promise<DirectoryEntry[]> {
    const adapter = await this.#getAdapter();
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
    const adapter = await this.#getAdapter();
    return adapter.resolveFile(basePath, options);
  }

  async refreshSourceSnapshot(reason?: string): Promise<void> {
    const adapter = await this.#getAdapter();
    if (isConcreteVeryfrontFSAdapter(adapter)) {
      await IntrinsicReflectApply(VeryfrontFSAdapterRefreshSourceSnapshot, adapter, [reason]);
    } else {
      await adapter.refreshSourceSnapshot(reason);
    }
    const cleared = clearRequestScopedFileCache();
    if (cleared > 0) {
      logger.debug("Cleared request-scoped file cache after source snapshot refresh", {
        reason,
        cleared,
      });
    }
  }

  async ensureSourceSnapshotFresh(
    reason?: string,
    options?: SourceSnapshotFreshnessOptions,
  ): Promise<void> {
    let initializedByManager = false;
    const adapter = await this.#getAdapter((initializedNow) => {
      initializedByManager = initializedNow;
    });
    let previousVersion: number | undefined;
    let currentVersion: number | undefined;
    if (isConcreteVeryfrontFSAdapter(adapter)) {
      previousVersion = IntrinsicReflectApply(
        VeryfrontFSAdapterGetSourceSnapshotVersion,
        adapter,
        [],
      ) as number;
      await IntrinsicReflectApply(VeryfrontFSAdapterEnsureSourceSnapshotFresh, adapter, [
        reason,
        options,
        initializedByManager,
      ]);
      currentVersion = IntrinsicReflectApply(
        VeryfrontFSAdapterGetSourceSnapshotVersion,
        adapter,
        [],
      ) as number;
    } else {
      const ensureSourceSnapshotFresh = adapter.ensureSourceSnapshotFresh;
      if (typeof ensureSourceSnapshotFresh !== "function") return;
      previousVersion = await adapter.getSourceSnapshotVersion?.();
      await IntrinsicReflectApply(ensureSourceSnapshotFresh, adapter, [
        reason,
        options,
        initializedByManager,
      ]);
      currentVersion = await adapter.getSourceSnapshotVersion?.();
    }
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
    const adapter = await this.#getAdapter();
    if (isConcreteVeryfrontFSAdapter(adapter)) {
      return IntrinsicReflectApply(
        VeryfrontFSAdapterGetSourceSnapshotVersion,
        adapter,
        [],
      ) as number;
    }
    return typeof adapter.getSourceSnapshotVersion === "function"
      ? await adapter.getSourceSnapshotVersion()
      : undefined;
  }

  async getSourceSnapshotFingerprint(): Promise<string | undefined> {
    const adapter = await this.#getAdapter();
    if (!isConcreteVeryfrontFSAdapter(adapter)) {
      return typeof adapter.getSourceSnapshotFingerprint === "function"
        ? await adapter.getSourceSnapshotFingerprint()
        : undefined;
    }
    return await IntrinsicReflectApply(
      VeryfrontFSAdapterGetSourceSnapshotFingerprint,
      adapter,
      [],
    );
  }

  async getSourceSnapshotIdentity(): Promise<string | undefined> {
    const adapter = await this.#getAdapter();
    const sourceIdentity = isConcreteVeryfrontFSAdapter(adapter)
      ? IntrinsicReflectApply(VeryfrontFSAdapterGetSourceSnapshotIdentity, adapter, []) as
        | string
        | undefined
      : typeof adapter.getSourceSnapshotIdentity === "function"
      ? await adapter.getSourceSnapshotIdentity()
      : undefined;
    if (sourceIdentity === undefined) return undefined;

    // The manager selects concrete adapters by project, source context, and a
    // credential-principal digest. The concrete source identity does not name
    // that selection, so bind it to an opaque instance generation. A different
    // credential or a recreated adapter must never reuse freshness established
    // on the previous instance, and no credential material enters the result.
    let generation = this.sourceSnapshotAdapterGenerations.get(adapter);
    if (generation === undefined) {
      generation = this.nextSourceSnapshotAdapterGeneration++;
      this.sourceSnapshotAdapterGenerations.set(adapter, generation);
    }
    return `adapter:${generation}:${sourceIdentity}`;
  }

  dispose(): void {
    this.manager.dispose();
    this.defaultAdapter?.dispose();
    this.defaultAdapter = undefined;
    logger.debug("Disposed");
  }

  getManagerStats(): ReturnType<ProxyFSAdapterManager["getStats"]> {
    return this.manager.getStats();
  }

  async getProjectData(): Promise<ReturnType<VeryfrontFSAdapter["getProjectData"]> | undefined> {
    try {
      const adapter = await this.#getAdapter();
      return adapter.getProjectData?.();
    } catch (error) {
      logger.debug("getProjectData failed", { error });
      return undefined;
    }
  }

  async getFilePathByEntityId(entityId: string): Promise<string | undefined> {
    try {
      const adapter = await this.#getAdapter();
      return adapter.getFilePathByEntityId?.(entityId);
    } catch (error) {
      logger.debug("getFilePathByEntityId failed", { entityId, error });
      return undefined;
    }
  }

  async getAllSourceFiles(
    options: { waitForWarmup?: boolean } = {},
  ): Promise<Array<{ path: string; content?: string }>> {
    try {
      const adapter = await this.#getAdapter();
      const files = (await adapter.getAllSourceFiles?.(options)) ?? [];

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
  return adapter instanceof MultiProjectFSAdapter;
}
