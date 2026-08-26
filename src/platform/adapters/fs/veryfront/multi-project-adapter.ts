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
const IntrinsicPromise = Promise;
const PromiseResolve = IntrinsicPromise.resolve;
const IntrinsicPerformance = performance;
const PerformanceNow = IntrinsicPerformance.now;
const NumberPrototypeToFixed = Number.prototype.toFixed;
const IntrinsicObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const IntrinsicObjectGetPrototypeOf = Object.getPrototypeOf;
const IntrinsicWeakMap = WeakMap;
const ObjectPrototypeIsPrototypeOf = Object.prototype.isPrototypeOf;
const WeakMapPrototypeGet = WeakMap.prototype.get;
const WeakMapPrototypeSet = WeakMap.prototype.set;
const ProxyFSAdapterManagerPrototype = ProxyFSAdapterManager.prototype;
const ProxyFSAdapterManagerGetAdapter = ProxyFSAdapterManagerPrototype.getAdapter;
const ProxyFSAdapterManagerDispose = ProxyFSAdapterManagerPrototype.dispose;
const ProxyFSAdapterManagerGetStats = ProxyFSAdapterManagerPrototype.getStats;
const VeryfrontFSAdapterPrototype = VeryfrontFSAdapter.prototype;
const VeryfrontFSAdapterReadFile = VeryfrontFSAdapterPrototype.readFile;
const VeryfrontFSAdapterReadTextFile = VeryfrontFSAdapterPrototype.readTextFile;
const VeryfrontFSAdapterRefreshSourceSnapshot = VeryfrontFSAdapterPrototype.refreshSourceSnapshot;
const VeryfrontFSAdapterEnsureSourceSnapshotFresh =
  VeryfrontFSAdapterPrototype.ensureSourceSnapshotFresh;
const VeryfrontFSAdapterGetSourceSnapshotVersion =
  VeryfrontFSAdapterPrototype.getSourceSnapshotVersion;
const VeryfrontFSAdapterGetSourceSnapshotFingerprint =
  VeryfrontFSAdapterPrototype.getSourceSnapshotFingerprint;
const VeryfrontFSAdapterGetSourceSnapshotIdentity =
  VeryfrontFSAdapterPrototype.getSourceSnapshotIdentity;
type CapturedAdapterMethod = (...args: never[]) => unknown;
type CapturedManagerMethod = (...args: never[]) => unknown;

function performanceNow(): number {
  return IntrinsicReflectApply(PerformanceNow, IntrinsicPerformance, []) as number;
}

function formatDuration(durationMs: number): string {
  return `${IntrinsicReflectApply(NumberPrototypeToFixed, durationMs, [2]) as string}ms`;
}

function weakMapGet<K extends WeakKey, V>(map: WeakMap<K, V>, key: K): V | undefined {
  return IntrinsicReflectApply(WeakMapPrototypeGet, map, [key]) as V | undefined;
}

function weakMapSet<K extends WeakKey, V>(map: WeakMap<K, V>, key: K, value: V): void {
  IntrinsicReflectApply(WeakMapPrototypeSet, map, [key, value]);
}

function isConcreteVeryfrontFSAdapter(adapter: VeryfrontFSAdapter): boolean {
  return IntrinsicReflectApply(
    ObjectPrototypeIsPrototypeOf,
    VeryfrontFSAdapterPrototype,
    [adapter],
  ) as boolean;
}

function captureEffectiveAdapterMethod(
  adapter: VeryfrontFSAdapter,
  key:
    | "readFile"
    | "readTextFile"
    | "refreshSourceSnapshot"
    | "ensureSourceSnapshotFresh"
    | "getSourceSnapshotVersion"
    | "getSourceSnapshotFingerprint"
    | "getSourceSnapshotIdentity",
  concreteMethod: CapturedAdapterMethod,
): CapturedAdapterMethod {
  const ownDescriptor = IntrinsicReflectApply(
    IntrinsicObjectGetOwnPropertyDescriptor,
    Object,
    [adapter, key],
  ) as PropertyDescriptor | undefined;
  if (ownDescriptor !== undefined) {
    if (!("value" in ownDescriptor) || typeof ownDescriptor.value !== "function") {
      throw new TypeError(`Veryfront filesystem adapter ${key} must be a data-property method`);
    }
    return ownDescriptor.value as CapturedAdapterMethod;
  }

  let owner = IntrinsicReflectApply(IntrinsicObjectGetPrototypeOf, Object, [adapter]) as
    | object
    | null;
  for (let depth = 0; owner !== null && depth < 64; depth++) {
    if (owner === VeryfrontFSAdapterPrototype) return concreteMethod;
    const descriptor = IntrinsicReflectApply(
      IntrinsicObjectGetOwnPropertyDescriptor,
      Object,
      [owner, key],
    ) as PropertyDescriptor | undefined;
    if (descriptor !== undefined) {
      if (!("value" in descriptor) || typeof descriptor.value !== "function") {
        throw new TypeError(`Veryfront filesystem adapter ${key} must be a data-property method`);
      }
      return descriptor.value as CapturedAdapterMethod;
    }
    owner = IntrinsicReflectApply(IntrinsicObjectGetPrototypeOf, Object, [owner]) as object | null;
  }
  throw new TypeError(`Veryfront filesystem adapter ${key} must inherit a function`);
}

function isConcreteProxyFSAdapterManager(manager: unknown): boolean {
  return IntrinsicReflectApply(
    ObjectPrototypeIsPrototypeOf,
    ProxyFSAdapterManagerPrototype,
    [manager],
  ) as boolean;
}

function captureEffectiveManagerMethod(
  manager: ProxyFSAdapterManager,
  key: "getAdapter" | "dispose" | "getStats",
  concreteMethod: CapturedManagerMethod,
): CapturedManagerMethod {
  const ownDescriptor = IntrinsicReflectApply(
    IntrinsicObjectGetOwnPropertyDescriptor,
    Object,
    [manager, key],
  ) as PropertyDescriptor | undefined;
  if (ownDescriptor !== undefined) {
    if (!("value" in ownDescriptor) || typeof ownDescriptor.value !== "function") {
      throw new TypeError(`Proxy filesystem adapter manager ${key} must be a data-property method`);
    }
    return ownDescriptor.value as CapturedManagerMethod;
  }

  let owner = IntrinsicReflectApply(IntrinsicObjectGetPrototypeOf, Object, [manager]) as
    | object
    | null;
  for (let depth = 0; owner !== null && depth < 64; depth++) {
    if (owner === ProxyFSAdapterManagerPrototype) return concreteMethod;
    const descriptor = IntrinsicReflectApply(
      IntrinsicObjectGetOwnPropertyDescriptor,
      Object,
      [owner, key],
    ) as PropertyDescriptor | undefined;
    if (descriptor !== undefined) {
      if (!("value" in descriptor) || typeof descriptor.value !== "function") {
        throw new TypeError(
          `Proxy filesystem adapter manager ${key} must be a data-property method`,
        );
      }
      return descriptor.value as CapturedManagerMethod;
    }
    owner = IntrinsicReflectApply(IntrinsicObjectGetPrototypeOf, Object, [owner]) as object | null;
  }
  throw new TypeError(`Proxy filesystem adapter manager ${key} must inherit a function`);
}

export class MultiProjectFSAdapter implements FSAdapter {
  readonly sourceSnapshotFreshnessOptionsVersion = 1 as const;
  readonly symlinkSemantics = "none" as const;
  #manager: ProxyFSAdapterManager;
  #managerGetAdapter: ProxyFSAdapterManager["getAdapter"];
  #managerDispose: ProxyFSAdapterManager["dispose"];
  #managerGetStats: ProxyFSAdapterManager["getStats"];
  private defaultAdapter?: VeryfrontFSAdapter;
  private readonly sourceSnapshotAdapterGenerations = new IntrinsicWeakMap<
    VeryfrontFSAdapter,
    number
  >();
  private nextSourceSnapshotAdapterGeneration = 1;

  constructor(config: FSAdapterConfig, manager?: ProxyFSAdapterManager) {
    this.#manager = manager ??
      new ProxyFSAdapterManager({
        baseConfig: config,
        maxAdapters: DEFAULT_MAX_ADAPTERS,
        cleanupIntervalMs: DEFAULT_CLEANUP_INTERVAL_MS,
        maxIdleMs: DEFAULT_MAX_IDLE_MS,
      });
    if (isConcreteProxyFSAdapterManager(this.#manager)) {
      this.#managerGetAdapter = captureEffectiveManagerMethod(
        this.#manager,
        "getAdapter",
        ProxyFSAdapterManagerGetAdapter,
      ) as ProxyFSAdapterManager["getAdapter"];
      this.#managerDispose = captureEffectiveManagerMethod(
        this.#manager,
        "dispose",
        ProxyFSAdapterManagerDispose,
      ) as ProxyFSAdapterManager["dispose"];
      this.#managerGetStats = captureEffectiveManagerMethod(
        this.#manager,
        "getStats",
        ProxyFSAdapterManagerGetStats,
      ) as ProxyFSAdapterManager["getStats"];
    } else {
      this.#managerGetAdapter = this.#manager.getAdapter;
      this.#managerDispose = this.#manager.dispose;
      this.#managerGetStats = this.#manager.getStats;
    }

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
        duration: formatDuration(performanceNow() - startTime),
      });

      // Release asset manifest fetchers are registered by the concrete adapter.
      // Materialize it before renderers can ask for the manifest on a first hit.
      if (productionMode && releaseId) {
        await this.#getAdapter();
      }

      const result = await runWithCacheBatching(fn);

      logger.debug("runWithContext callback complete", {
        projectSlug,
        totalDuration: formatDuration(performanceNow() - startTime),
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
    const adapter = await IntrinsicReflectApply(
      this.#managerGetAdapter,
      this.#manager,
      args,
    ) as VeryfrontFSAdapter;

    logger.debug("getAdapter DONE", {
      projectSlug: context.projectSlug,
      duration: formatDuration(performanceNow() - startTime),
    });

    return adapter;
  }

  setDefaultAdapter(adapter: VeryfrontFSAdapter): void {
    this.defaultAdapter = adapter;
  }

  initialize(): Promise<void> {
    logger.debug("Initialized (lazy per-project initialization)");
    return IntrinsicReflectApply(PromiseResolve, IntrinsicPromise, []) as Promise<void>;
  }

  async readFile(path: string): Promise<string> {
    const adapter = await this.#getAdapter();
    if (!isConcreteVeryfrontFSAdapter(adapter)) return await adapter.readFile(path);
    const readFile = captureEffectiveAdapterMethod(
      adapter,
      "readFile",
      VeryfrontFSAdapterReadFile,
    );
    return await IntrinsicReflectApply(readFile, adapter, [path]) as string;
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
    if (!isConcreteVeryfrontFSAdapter(adapter)) return await adapter.readTextFile(path);
    const readTextFile = captureEffectiveAdapterMethod(
      adapter,
      "readTextFile",
      VeryfrontFSAdapterReadTextFile,
    );
    return await IntrinsicReflectApply(readTextFile, adapter, [path]) as string;
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
      const refreshSourceSnapshot = captureEffectiveAdapterMethod(
        adapter,
        "refreshSourceSnapshot",
        VeryfrontFSAdapterRefreshSourceSnapshot,
      );
      await IntrinsicReflectApply(refreshSourceSnapshot, adapter, [reason]);
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
      const getSourceSnapshotVersion = captureEffectiveAdapterMethod(
        adapter,
        "getSourceSnapshotVersion",
        VeryfrontFSAdapterGetSourceSnapshotVersion,
      );
      const ensureSourceSnapshotFresh = captureEffectiveAdapterMethod(
        adapter,
        "ensureSourceSnapshotFresh",
        VeryfrontFSAdapterEnsureSourceSnapshotFresh,
      );
      previousVersion = IntrinsicReflectApply(
        getSourceSnapshotVersion,
        adapter,
        [],
      ) as number;
      await IntrinsicReflectApply(ensureSourceSnapshotFresh, adapter, [
        reason,
        options,
        initializedByManager,
      ]);
      currentVersion = IntrinsicReflectApply(
        getSourceSnapshotVersion,
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
      const getSourceSnapshotVersion = captureEffectiveAdapterMethod(
        adapter,
        "getSourceSnapshotVersion",
        VeryfrontFSAdapterGetSourceSnapshotVersion,
      );
      return IntrinsicReflectApply(
        getSourceSnapshotVersion,
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
    const getSourceSnapshotFingerprint = captureEffectiveAdapterMethod(
      adapter,
      "getSourceSnapshotFingerprint",
      VeryfrontFSAdapterGetSourceSnapshotFingerprint,
    );
    return await IntrinsicReflectApply(
      getSourceSnapshotFingerprint,
      adapter,
      [],
    );
  }

  async getSourceSnapshotIdentity(): Promise<string | undefined> {
    const adapter = await this.#getAdapter();
    const sourceIdentity = isConcreteVeryfrontFSAdapter(adapter)
      ? IntrinsicReflectApply(
        captureEffectiveAdapterMethod(
          adapter,
          "getSourceSnapshotIdentity",
          VeryfrontFSAdapterGetSourceSnapshotIdentity,
        ),
        adapter,
        [],
      ) as string | undefined
      : typeof adapter.getSourceSnapshotIdentity === "function"
      ? await adapter.getSourceSnapshotIdentity()
      : undefined;
    if (sourceIdentity === undefined) return undefined;

    // The manager selects concrete adapters by project, source context, and a
    // credential-principal digest. The concrete source identity does not name
    // that selection, so bind it to an opaque instance generation. A different
    // credential or a recreated adapter must never reuse freshness established
    // on the previous instance, and no credential material enters the result.
    let generation = weakMapGet(this.sourceSnapshotAdapterGenerations, adapter);
    if (generation === undefined) {
      generation = this.nextSourceSnapshotAdapterGeneration++;
      weakMapSet(this.sourceSnapshotAdapterGenerations, adapter, generation);
    }
    return `adapter:${generation}:${sourceIdentity}`;
  }

  dispose(): void {
    IntrinsicReflectApply(this.#managerDispose, this.#manager, []);
    this.defaultAdapter?.dispose();
    this.defaultAdapter = undefined;
    logger.debug("Disposed");
  }

  getManagerStats(): ReturnType<ProxyFSAdapterManager["getStats"]> {
    return IntrinsicReflectApply(
      this.#managerGetStats,
      this.#manager,
      [],
    ) as ReturnType<ProxyFSAdapterManager["getStats"]>;
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
