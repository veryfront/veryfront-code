import { logger as baseLogger } from "#veryfront/utils/logger/logger.ts";
import { createError, toError } from "#veryfront/errors/veryfront-error.ts";
import {
  type CacheStats,
  type ContentSource,
  type DirectoryEntry,
  FS_ADAPTER_KIND,
  type FSAdapter,
  type FSAdapterConfig,
  type InvalidationCallbacks,
  type ResolvedContentContext,
  type StyleCallbacks,
  type StylePregenerationFile,
} from "./types.ts";
import type { FileInfo, ResolveFileOptions } from "../../base.ts";
import {
  type FileContext,
  type Project,
  VeryfrontApiClient,
  type VeryfrontAPIRequestIdentity,
} from "../../veryfront-api-client/index.ts";
import { FileCache } from "../cache/file-cache.ts";
import { PathNormalizer } from "./path-normalizer.ts";
import { ReadOperations } from "./read-operations.ts";
import { DirectoryOperations } from "./directory-operations.ts";
import { StatOperations } from "./stat-operations.ts";
import {
  buildDirCacheKeyPrefix,
  buildFileCacheKeyPrefix,
  buildFileListCacheKey,
  buildStatCacheKeyPrefix,
} from "./cache-keys.ts";
import { isPrefixBeingInvalidated } from "./invalidation-state.ts";
import { WebSocketManager } from "./websocket-manager.ts";
import {
  fetchFileListForContext,
  hasContentContextChanged,
  resolveContentContext,
  summarizeFileList,
  toClientContext,
} from "./adapter-content-context.ts";
import {
  buildFileCacheOptions,
  buildRetryConfig,
  shouldBackgroundPregenerateStyles,
} from "./adapter-helpers.ts";
import { isNotFoundLikeError } from "./read-operations-helpers.ts";
import { getCurrentRequestContext } from "./request-context.ts";
import { createDefaultInvalidationCallbacks } from "./default-invalidation-callbacks.ts";
import { snapshotVeryfrontFSAdapterConfig } from "./config-snapshot.ts";
import {
  classifyFilesystemError,
  classifyFilesystemReason,
  toFilesystemPublicError,
} from "./telemetry.ts";

import {
  clearCachedReleaseAssetManifests,
  registerManifestFetcherForRelease,
  type ReleaseAssetManifestFetcher,
  unregisterManifestFetcherForRelease,
} from "#veryfront/release-assets/manifest-cache.ts";
import { parseReleaseAssetManifest } from "#veryfront/release-assets/manifest-schema.ts";

const logger = baseLogger.component("veryfront-fs-adapter");
const BRANCH_MISS_RECOVERY_FAILURE_TTL_MS = 5_000;

interface BranchSnapshotRecoveryOptions<T> {
  isRecoverableMissResult?: (result: T) => boolean;
  requirePendingSourceInvalidation?: boolean;
}

function fileContextsMatch(left: FileContext, right: FileContext): boolean {
  switch (left.type) {
    case "branch":
      return right.type === "branch" && left.name === right.name;
    case "environment":
      return right.type === "environment" && left.name === right.name;
    case "release":
      return right.type === "release" && left.version === right.version;
  }
}

/**
 * Build a project-scoped manifest fetcher backed by the given API client.
 *
 * The fetcher resolves a manifest for a specific release via the GET endpoint.
 * Registered per-releaseId in `setContentContext` so each releaseId is always
 * served by the client (and token) that owns it.
 */
function buildManifestFetcher(
  client: VeryfrontApiClient,
): (
  releaseId: string,
) => Promise<{ state: string; manifest: ReturnType<typeof parseReleaseAssetManifest> } | null> {
  return async (releaseId: string) => {
    try {
      const response = await client.getReleaseAssetManifest(releaseId);
      return {
        state: response.state,
        manifest: response.manifest ? parseReleaseAssetManifest(response.manifest) : null,
      };
    } catch (error) {
      throw toFilesystemPublicError(error);
    }
  };
}

export class VeryfrontFSAdapter implements FSAdapter {
  readonly [FS_ADAPTER_KIND] = "veryfront" as const;
  private client: VeryfrontApiClient;
  private manifestClient: VeryfrontApiClient | null;
  private manifestFetcherRegistration: {
    releaseId: string;
    fetcher: ReleaseAssetManifestFetcher;
  } | null = null;
  private cache: FileCache;
  private normalizer: PathNormalizer;
  private readOps: ReadOperations;
  private dirOps: DirectoryOperations;
  private statOps: StatOperations;
  private initialized = false;

  /** Resolves when file list initialization is complete (for coordinating reads) */
  private fileListReadyResolve: (() => void) | null = null;
  /** Single-flight background rewarm when the file list cache disappears */
  private fileListWarmupPromise: Promise<void> | null = null;
  private fileListWarmupKey: string | null = null;
  /** Single-flight foreground refresh when a branch preview read misses a newly pushed file. */
  private branchMissRecoveryPromise: Promise<void> | null = null;
  private branchMissRecoveryGeneration = 0;
  private readonly branchMissRecoveryFailures = new Map<string, number>();

  private projectData?: Project;
  private apiBaseUrl: string;
  private apiToken: string;
  private projectSlug: string;
  private invalidationCallbacks: InvalidationCallbacks;
  private styleCallbacks: StyleCallbacks;
  private wsManager: WebSocketManager;

  /** Per-request branch override (for branch preview URLs) */
  private requestBranch: string | null = null;

  /** Content source configuration from config */
  private contentSource: ContentSource;
  /** Resolved content context after initialization (includes resolved releaseId for env/domain) */
  private contentContext: ResolvedContentContext | null = null;
  /** Whether running in proxy mode (shared adapter with per-request OAuth tokens) */
  private proxyMode: boolean;

  private getCurrentFileListCacheKey(): string | undefined {
    return this.contentContext ? buildFileListCacheKey(this.contentContext) : undefined;
  }

  private syncClientContext(): void {
    this.client.clearRequestBranch();

    if (this.contentContext) {
      this.client.setContext(toClientContext(this.contentContext));
    } else {
      this.client.clearContext();
    }

    if (this.requestBranch) {
      this.client.setRequestBranch(this.requestBranch);
    }
  }

  private getRequestIdentity(): VeryfrontAPIRequestIdentity | undefined {
    if (!this.proxyMode) return undefined;

    const context = getCurrentRequestContext();
    if (!context) return undefined;
    if (context.projectSlug !== this.projectSlug) {
      throw new Error("Active request project does not match the filesystem adapter project");
    }

    let fileContext: FileContext;
    if (!context.productionMode) {
      fileContext = Object.freeze({ type: "branch", name: context.branch ?? "main" });
    } else if (context.releaseId) {
      fileContext = Object.freeze({ type: "release", version: context.releaseId });
    } else if (context.environmentName) {
      fileContext = Object.freeze({ type: "environment", name: context.environmentName });
    } else {
      throw new Error("Active production request has no release or environment context");
    }

    if (this.contentContext) {
      const adapterFileContext = toClientContext(this.contentContext);
      if (!fileContextsMatch(fileContext, adapterFileContext)) {
        throw new Error(
          "Active request file context does not match the filesystem adapter context",
        );
      }
    }

    return Object.freeze({
      token: context.token,
      projectSlug: context.projectSlug,
      fileContext,
    });
  }

  private connectWebSocket(projectId: string): void {
    if (!this.apiToken) {
      logger.debug("Skipping WebSocket connection without a stable API token");
      return;
    }

    this.wsManager.connect(projectId);
  }

  private getCachedFileListSync<T extends { path: string; id?: string }>(): T[] | undefined {
    const cacheKey = this.getCurrentFileListCacheKey();
    if (!cacheKey) return undefined;
    return this.cache.get(cacheKey) as T[] | undefined;
  }

  private async getCachedFileListAsync<T extends { path: string }>(
    noContextMessage: string,
    lookupLabel: string,
    missReason: string,
  ): Promise<{ cacheKey: string; files: T[] | undefined } | undefined> {
    const cacheKey = this.getCurrentFileListCacheKey();
    if (!cacheKey) {
      logger.debug(noContextMessage);
      return undefined;
    }

    const files = await this.cache.getAsync<T[]>(cacheKey);
    logger.debug(`${lookupLabel} lookup`, {
      hasResult: !!files,
      resultSize: files?.length ?? 0,
      hasContent: (files as Array<{ content?: string }> | undefined)?.filter((file) =>
        !!file.content
      )?.length ?? 0,
    });

    if (!files?.length) {
      this.scheduleFileListWarmup(missReason, cacheKey);
    }

    return { cacheKey, files };
  }

  constructor(config: FSAdapterConfig) {
    const configSnapshot = snapshotVeryfrontFSAdapterConfig(config);
    this.invalidationCallbacks = createDefaultInvalidationCallbacks(
      configSnapshot.invalidationCallbacks,
    );
    this.styleCallbacks = configSnapshot.styleCallbacks ?? Object.freeze({});
    const vf = configSnapshot.veryfront!;

    this.apiBaseUrl = vf.apiBaseUrl ?? "";
    this.apiToken = vf.apiToken ?? "";
    this.projectSlug = vf.projectSlug ?? "";
    this.contentSource = vf.contentSource ?? Object.freeze({ type: "branch", branch: "main" });
    this.proxyMode = vf.proxyMode ?? false;

    const retryConfig = buildRetryConfig(vf.retry);

    this.client = new VeryfrontApiClient({
      apiBaseUrl: this.apiBaseUrl,
      apiToken: this.apiToken,
      projectSlug: this.projectSlug,
      projectId: vf.projectId,
      proxyMode: vf.proxyMode,
      requestIdentityProvider: () => this.getRequestIdentity(),
      retry: retryConfig,
    });
    this.manifestClient = this.apiToken
      ? new VeryfrontApiClient({
        apiBaseUrl: this.apiBaseUrl,
        apiToken: this.apiToken,
        projectSlug: this.projectSlug,
        projectId: vf.projectId,
        retry: retryConfig,
      })
      : null;

    const cacheConfig = buildFileCacheOptions(vf.cache);

    this.cache = new FileCache(cacheConfig);
    this.normalizer = new PathNormalizer(configSnapshot.projectDir);
    // Per-releaseId fetcher registration is done in setContentContext when a
    // release context is resolved, ensuring the correct project-scoped token.

    const contentContextGetter = {
      isProductionMode: () => this.contentContext?.sourceType !== "branch",
      getReleaseId: () => this.contentContext?.releaseId ?? null,
      getContentContext: () => this.contentContext,
      getFileList: async () => {
        const cached = await this.getCachedFileListAsync<{
          id?: string;
          path: string;
          content?: string;
          type?: string;
          size?: number;
          updated_at?: string;
        }>("getFileList: no contentContext", "getFileList", "getFileList miss");
        return cached?.files;
      },
      hasCachedFileList: async () => {
        const cached = await this.getCachedFileListAsync<{ path: string }>(
          "hasCachedFileList: no contentContext",
          "hasCachedFileList",
          "hasCachedFileList miss",
        );
        return Array.isArray(cached?.files) && cached.files.length > 0;
      },
      isPersistentCacheInvalidated: (prefix: string) => this.isPersistentCacheInvalidated(prefix),
      isReleaseBeingInvalidated: (releaseId: string) =>
        this.isPersistentCacheInvalidated(
          buildFileCacheKeyPrefix({
            sourceType: "release",
            projectSlug: this.projectSlug,
            releaseId,
          }),
        ),
    };

    this.statOps = new StatOperations(
      this.client,
      this.cache,
      this.normalizer,
      contentContextGetter,
    );

    this.readOps = new ReadOperations(
      this.client,
      this.cache,
      this.normalizer,
      contentContextGetter,
      (path) => this.statOps.getOriginalApiPath(path),
      async () => {
        const cached = await this.getCachedFileListAsync<{ path: string; content?: string }>(
          "getFileListCache: no contentContext",
          "getFileListCache",
          "getFileListCache miss",
        );
        return cached?.files;
      },
    );

    this.dirOps = new DirectoryOperations(
      this.client,
      this.cache,
      this.normalizer,
      contentContextGetter,
    );

    this.wsManager = new WebSocketManager({
      apiBaseUrl: this.apiBaseUrl,
      apiToken: this.apiToken,
      projectSlug: this.projectSlug,
      cache: this.cache,
      client: this.client,
      invalidationCallbacks: this.invalidationCallbacks,
      getContentContext: () => this.contentContext,
      getContentSource: () => this.contentSource,
      getProjectDir: () => this.normalizer.getProjectDir(),
      clearMemoryCaches: () => {
        clearCachedReleaseAssetManifests();
        this.readOps.clearFileListIndex();
        this.statOps.clearIndex();
        this.dirOps.clearTree();
      },
      clearFileListIndex: () => this.readOps.clearFileListIndex(),
      setFileListCache: (cacheKey, files) => this.cache.setAsync(cacheKey, files),
      pregenerateStyles: (files) => this.triggerCSSPregeneration(files),
    });

    logger.debug("Created", {
      sourceType: this.contentSource.type,
      proxyMode: this.proxyMode,
      hasProjectDirectory: !!configSnapshot.projectDir,
      cacheEnabled: cacheConfig.enabled,
    });
  }

  async initialize(): Promise<void> {
    try {
      await this.initializeInternal();
    } catch (error) {
      // Resolve (not reject) to avoid an unhandled-rejection crash when no lookup is awaiting.
      this.fileListReadyResolve?.();
      this.fileListReadyResolve = null;
      throw toFilesystemPublicError(error);
    }
  }

  private async initializeInternal(): Promise<void> {
    const initStartTime = performance.now();
    logger.debug("initialize START", {
      sourceType: this.contentSource.type,
      alreadyInitialized: this.initialized,
    });

    if (this.initialized) {
      logger.debug("Already initialized, skipping");
      return;
    }

    const fileListReadyPromise = new Promise<void>((resolve) => {
      this.fileListReadyResolve = resolve;
    });
    this.readOps.setFileListReadyPromise(fileListReadyPromise);

    logger.debug("Step 1: client.initialize START");
    const step1Start = performance.now();
    const initialization = await this.client.initializeProject();
    logger.debug("Step 1: client.initialize DONE", {
      durationMs: Math.round(performance.now() - step1Start),
    });

    const projectId = initialization.projectId;
    logger.debug("Step 2: getProject START");
    const step2Start = performance.now();

    const initializedProject = initialization.project;
    this.projectData = initializedProject ?? (await this.client.getProject(projectId));

    logger.debug(
      `[VeryfrontFSAdapter] Step 2: getProject DONE (${
        initializedProject ? "from cache" : "from API"
      })`,
      {
        projectSource: initializedProject ? "cache" : "api",
        durationMs: Math.round(performance.now() - step2Start),
      },
    );

    if (!this.contentContext) {
      logger.debug("Step 3: resolveContentSource START", {
        sourceType: this.contentSource.type,
      });
      const step3Start = performance.now();
      const resolvedContext = await resolveContentContext(
        this.client,
        this.contentSource,
        this.projectSlug,
      );
      this.setContentContext(resolvedContext);
      logger.debug("Step 3: resolveContentSource DONE", {
        sourceType: resolvedContext.sourceType,
        durationMs: Math.round(performance.now() - step3Start),
      });
    } else {
      logger.debug("Step 3: Content context already set", {
        sourceType: this.contentContext.sourceType,
      });
    }

    const contentContext = this.contentContext;
    if (!contentContext) {
      throw toError(
        createError({
          type: "config",
          message: "Veryfront adapter content context resolution failed",
        }),
      );
    }

    logger.debug("Content context resolved", {
      sourceType: contentContext.sourceType,
    });

    const cacheKey = buildFileListCacheKey(contentContext);
    logger.debug("Step 4: fetchFileList START", { sourceType: contentContext.sourceType });

    try {
      const files = await fetchFileListForContext(this.client, contentContext);
      const fileSummary = summarizeFileList(files);

      await this.cache.setAsync(cacheKey, files);

      this.fileListReadyResolve?.();
      this.fileListReadyResolve = null;

      logger.debug("Fetched files during initialization", {
        totalFiles: fileSummary.totalFiles,
        filesWithContent: fileSummary.filesWithContent,
        sourceFiles: fileSummary.sourceFiles,
        sourceFilesWithContent: fileSummary.sourceFilesWithContent,
      });

      // Trigger CSS pre-generation after the initial file snapshot is ready for
      // published contexts. Branch previews should first try remote metadata
      // recovery on cold starts instead of repopulating the prepared cache here.
      if (fileSummary.sourceFilesWithContent > 0 && this.shouldBackgroundPregenerateStyles()) {
        this.triggerCSSPregeneration(files).catch(() => {
          // Error already logged in triggerCSSPregeneration
        });
      }

      this.initialized = true;

      logger.debug("initialize COMPLETE", {
        fileCount: files.length,
        durationMs: Math.round(performance.now() - initStartTime),
      });

      if (contentContext.sourceType === "branch") {
        logger.debug("Initialized (branch mode)", {
          files: files.length,
          proxyMode: this.proxyMode,
        });
        this.connectWebSocket(projectId);
        return;
      }

      logger.debug("Initialized (published mode)", {
        files: files.length,
        sourceType: contentContext.sourceType,
      });

      // Keep a WebSocket connection in environment mode to receive deployment pokes.
      // Release mode is immutable, so no need to keep a live connection.
      if (contentContext.sourceType === "environment") {
        this.connectWebSocket(projectId);
      }
    } catch (error) {
      // Resolve (not reject) to avoid an unhandled-rejection crash in Deno when no lookup() is awaiting.
      this.fileListReadyResolve?.();
      this.fileListReadyResolve = null;
      throw error;
    }
  }

  private isPersistentCacheInvalidated(prefix: string): boolean {
    return isPrefixBeingInvalidated(prefix);
  }

  private shouldBackgroundPregenerateStyles(): boolean {
    // Branch previews should recover the last registered stylesheet artifact on
    // cold starts before rebuilding CSS locally. Live edit pokes still
    // pregenerate through the WebSocket path after branch content changes.
    return shouldBackgroundPregenerateStyles(this.contentContext);
  }

  private getBranchMissRecoveryKey(path: string): string {
    const normalizedPath = this.normalizer.normalize(path);
    const branch = this.requestBranch ?? this.contentContext?.branch ?? "main";
    return `${this.projectSlug}:${branch}:${normalizedPath}`;
  }

  private hasRecentBranchMissRecoveryFailure(key: string): boolean {
    const failedAt = this.branchMissRecoveryFailures.get(key);
    if (!failedAt) return false;

    if (Date.now() - failedAt < BRANCH_MISS_RECOVERY_FAILURE_TTL_MS) return true;

    this.branchMissRecoveryFailures.delete(key);
    return false;
  }

  private shouldRecoverBranchMiss(path: string, error: unknown): boolean {
    if (this.contentContext?.sourceType !== "branch") return false;
    if (!isNotFoundLikeError(error)) return false;

    const recoveryKey = this.getBranchMissRecoveryKey(path);
    return !this.hasRecentBranchMissRecoveryFailure(recoveryKey);
  }

  private shouldRecoverBranchMissResult<T>(
    path: string,
    result: T,
    options?: BranchSnapshotRecoveryOptions<T>,
  ): boolean {
    if (this.contentContext?.sourceType !== "branch") return false;
    if (!options?.isRecoverableMissResult?.(result)) return false;
    if (
      options.requirePendingSourceInvalidation &&
      !this.isPersistentCacheInvalidated(buildFileCacheKeyPrefix(this.contentContext))
    ) {
      return false;
    }

    const recoveryKey = this.getBranchMissRecoveryKey(path);
    return !this.hasRecentBranchMissRecoveryFailure(recoveryKey);
  }

  private async refreshBranchSnapshotAfterMiss(path: string): Promise<void> {
    let recoveryPromise = this.branchMissRecoveryPromise;
    let ownsRecovery = false;
    let recoveryGeneration = this.branchMissRecoveryGeneration;

    if (!recoveryPromise) {
      const normalizedPath = this.normalizer.normalize(path);
      recoveryPromise = this.refreshSourceSnapshot(`branch-miss:${normalizedPath}`);
      this.branchMissRecoveryPromise = recoveryPromise;
      recoveryGeneration = ++this.branchMissRecoveryGeneration;
      ownsRecovery = true;
    }

    try {
      await recoveryPromise;
    } finally {
      if (ownsRecovery && this.branchMissRecoveryGeneration === recoveryGeneration) {
        this.branchMissRecoveryPromise = null;
      }
    }
  }

  private async withBranchSnapshotRecovery<T>(
    path: string,
    operation: () => Promise<T>,
    options?: BranchSnapshotRecoveryOptions<T>,
  ): Promise<T> {
    try {
      const result = await operation();
      if (!this.shouldRecoverBranchMissResult(path, result, options)) return result;

      const recoveryKey = this.getBranchMissRecoveryKey(path);
      try {
        await this.refreshBranchSnapshotAfterMiss(path);
      } catch (refreshError) {
        this.branchMissRecoveryFailures.set(recoveryKey, Date.now());
        logger.warn("Branch snapshot recovery failed after result miss", {
          errorClass: classifyFilesystemError(refreshError),
        });
        return result;
      }

      const retryResult = await operation();
      if (options?.isRecoverableMissResult?.(retryResult)) {
        this.branchMissRecoveryFailures.set(recoveryKey, Date.now());
      }
      return retryResult;
    } catch (error) {
      if (!this.shouldRecoverBranchMiss(path, error)) throw error;

      const recoveryKey = this.getBranchMissRecoveryKey(path);
      try {
        await this.refreshBranchSnapshotAfterMiss(path);
      } catch (refreshError) {
        this.branchMissRecoveryFailures.set(recoveryKey, Date.now());
        logger.warn("Branch snapshot recovery failed after not-found miss", {
          errorClass: classifyFilesystemError(refreshError),
        });
        throw error;
      }

      try {
        return await operation();
      } catch (retryError) {
        if (isNotFoundLikeError(retryError)) {
          this.branchMissRecoveryFailures.set(recoveryKey, Date.now());
        }
        throw retryError;
      }
    }
  }

  private scheduleFileListWarmup(reason: string, cacheKey?: string): void {
    if (!this.initialized || !this.contentContext) return;

    const effectiveCacheKey = cacheKey ?? buildFileListCacheKey(this.contentContext);

    if (this.fileListWarmupPromise && this.fileListWarmupKey === effectiveCacheKey) {
      logger.debug("File list warmup already in progress", {
        reason: classifyFilesystemReason(reason),
      });
      return;
    }

    const warmupContext = this.contentContext;
    let warmupPromise: Promise<void> | null = null;
    warmupPromise = (async () => {
      try {
        const existing = await this.cache.getAsync<Array<{ path: string; content?: string }>>(
          effectiveCacheKey,
        );

        if (existing?.length) {
          logger.debug("Skipping file list warmup because cache is already populated", {
            reason: classifyFilesystemReason(reason),
            fileCount: existing.length,
          });
          return;
        }

        logger.debug("Starting file list warmup", {
          reason: classifyFilesystemReason(reason),
          sourceType: warmupContext.sourceType,
        });

        const files = await fetchFileListForContext(this.client, warmupContext);
        await this.cache.setAsync(effectiveCacheKey, files);
        const fileSummary = summarizeFileList(files);

        if (fileSummary.sourceFilesWithContent > 0 && this.shouldBackgroundPregenerateStyles()) {
          this.triggerCSSPregeneration(files).catch(() => {
            // Error already logged in triggerCSSPregeneration
          });
        }

        logger.debug("File list warmup complete", {
          reason: classifyFilesystemReason(reason),
          totalFiles: files.length,
          filesWithContent: files.filter((file) => file.content).length,
        });
      } catch (error) {
        logger.warn("File list warmup failed", {
          reason: classifyFilesystemReason(reason),
          errorClass: classifyFilesystemError(error),
        });
      } finally {
        if (warmupPromise && this.fileListWarmupPromise === warmupPromise) {
          this.fileListWarmupPromise = null;
          this.fileListWarmupKey = null;
        }
      }
    })();

    this.fileListWarmupPromise = warmupPromise;
    this.fileListWarmupKey = effectiveCacheKey;
    this.readOps.setFileListReadyPromise(warmupPromise);
  }

  async refreshSourceSnapshot(reason = "manual-refresh"): Promise<void> {
    try {
      await this.refreshSourceSnapshotInternal(reason);
    } catch (error) {
      throw toFilesystemPublicError(error);
    }
  }

  private async refreshSourceSnapshotInternal(reason: string): Promise<void> {
    await this.ensureInitialized();

    if (!this.contentContext) {
      logger.debug("Skipping source snapshot refresh without content context", {
        reason: classifyFilesystemReason(reason),
      });
      return;
    }

    const cacheKey = buildFileListCacheKey(this.contentContext);
    const refreshContext = this.contentContext;

    this.fileListWarmupPromise = null;
    this.fileListWarmupKey = null;
    this.readOps.clearFileListIndex();
    this.statOps.clearIndex();
    this.dirOps.clearTree();

    await Promise.all([
      this.cache.deleteByPrefixAsync(buildFileCacheKeyPrefix(refreshContext)),
      this.cache.deleteByPrefixAsync(buildStatCacheKeyPrefix(refreshContext)),
      this.cache.deleteByPrefixAsync(buildDirCacheKeyPrefix(refreshContext)),
      this.cache.deleteAsync(cacheKey),
    ]);

    const files = await fetchFileListForContext(this.client, refreshContext);
    await this.cache.setAsync(cacheKey, files);
    const fileSummary = summarizeFileList(files);
    this.branchMissRecoveryFailures.clear();

    if (fileSummary.sourceFilesWithContent > 0 && this.shouldBackgroundPregenerateStyles()) {
      this.triggerCSSPregeneration(files).catch(() => {
        // Error already logged in triggerCSSPregeneration
      });
    }

    logger.info("Refreshed source snapshot", {
      reason: classifyFilesystemReason(reason),
      sourceType: refreshContext.sourceType,
      totalFiles: fileSummary.totalFiles,
      filesWithContent: fileSummary.filesWithContent,
    });
  }

  getPokeMetrics(): {
    received: number;
    invalidationsTriggered: number;
    lastPokeTime: number;
    connectionId: string | null;
  } {
    return this.wsManager.getPokeMetrics();
  }

  async readFile(path: string): Promise<string> {
    await this.ensureInitialized();
    return this.withBranchSnapshotRecovery(path, () => this.readOps.readTextFile(path));
  }

  async readFileBytes(path: string): Promise<Uint8Array> {
    await this.ensureInitialized();
    return this.withBranchSnapshotRecovery(path, () => this.readOps.readFile(path));
  }

  async readTextFile(path: string): Promise<string> {
    await this.ensureInitialized();
    return this.withBranchSnapshotRecovery(path, () => this.readOps.readTextFile(path));
  }

  async readOptionalTextFile(path: string): Promise<string> {
    await this.ensureInitialized();
    return this.withBranchSnapshotRecovery(path, () => this.readOps.readOptionalTextFile(path));
  }

  async readdir(path: string): Promise<DirectoryEntry[]> {
    await this.ensureInitialized();
    return this.withBranchSnapshotRecovery(
      path,
      () => this.dirOps.readdir(path),
      {
        isRecoverableMissResult: (entries) => entries.length === 0,
        requirePendingSourceInvalidation: true,
      },
    );
  }

  async stat(path: string): Promise<FileInfo> {
    await this.ensureInitialized();
    return this.withBranchSnapshotRecovery(path, () => this.statOps.stat(path));
  }

  async exists(path: string): Promise<boolean> {
    await this.ensureInitialized();
    try {
      await this.withBranchSnapshotRecovery(path, () => this.statOps.stat(path));
      return true;
    } catch (_) {
      return false;
    }
  }

  async resolveFile(
    basePath: string,
    options?: ResolveFileOptions,
  ): Promise<string | null> {
    await this.ensureInitialized();
    return this.withBranchSnapshotRecovery(
      basePath,
      () => this.statOps.resolveFile(basePath, options),
      {
        isRecoverableMissResult: (resolvedPath) => resolvedPath === null,
        requirePendingSourceInvalidation: true,
      },
    );
  }

  dispose(): void {
    this.clearManifestFetcherRegistration();
    this.wsManager.dispose();
    this.cache.clear();
    this.statOps.clearIndex();
    this.dirOps.clearTree();
    this.initialized = false;
    this.fileListWarmupPromise = null;
    this.fileListWarmupKey = null;
    this.branchMissRecoveryPromise = null;
    this.branchMissRecoveryGeneration++;
    this.branchMissRecoveryFailures.clear();

    logger.debug("Disposed");
  }

  getCacheStats(): CacheStats {
    return { cache: this.cache.stats(), poke: this.getPokeMetrics() };
  }

  getProjectData(): Project | undefined {
    return this.projectData;
  }

  async getAllSourceFiles(): Promise<Array<{ path: string; content?: string }>> {
    if (!this.contentContext) {
      logger.debug("getAllSourceFiles called without contentContext", {
        initialized: this.initialized,
      });
      return [];
    }

    const cached = await this.getCachedFileListAsync<{ path: string; content?: string }>(
      "getAllSourceFiles: no contentContext",
      "getAllSourceFiles",
      "getAllSourceFiles miss",
    );
    const cacheKey = cached?.cacheKey;
    const files = cached?.files;

    if (!cacheKey || !files?.length) {
      logger.debug("getAllSourceFiles cache miss or empty", {
        initialized: this.initialized,
        hasFiles: !!files,
        fileCount: files?.length ?? 0,
      });
      return [];
    }

    const fileSummary = summarizeFileList(files);

    logger.debug("getAllSourceFiles returning", {
      totalFiles: fileSummary.totalFiles,
      filesWithContent: fileSummary.filesWithContent,
      sourceFiles: fileSummary.sourceFiles,
      sourceFilesWithContent: fileSummary.sourceFilesWithContent,
    });

    return files;
  }

  getEntityIdForPath(path: string): string | undefined {
    const normalizedPath = this.normalizer.normalize(path);
    const cachedFiles = this.getCachedFileListSync<{ id?: string; path: string }>();

    return cachedFiles?.find((f) => f.path === normalizedPath)?.id;
  }

  getFilePathByEntityId(entityId: string): string | undefined {
    const cachedFiles = this.getCachedFileListSync<{ id?: string; path: string }>();

    return cachedFiles?.find((f) => f.id === entityId)?.path;
  }

  async getFilePathByEntityIdAsync(
    entityId: string,
  ): Promise<{ path: string; body?: string } | undefined> {
    const cachedPath = this.getFilePathByEntityId(entityId);
    if (cachedPath) return { path: cachedPath };

    logger.debug("Fetching file by entity ID from API");

    try {
      const file = await this.client.getFileById(entityId);
      if (!file) return undefined;

      logger.debug("File resolved from API", {
        contentLength: file.content.length,
      });

      return { path: file.path, body: file.content };
    } catch (error) {
      logger.warn("Failed to fetch file by entity ID", {
        errorClass: classifyFilesystemError(error),
      });
      return undefined;
    }
  }

  /** @deprecated Use request-scoped adapter routing for concurrent requests. */
  setRequestToken(token: string): void {
    this.client.setRequestToken(token);
  }

  clearRequestToken(): void {
    this.client.clearRequestToken();
  }

  /** @deprecated Use request-scoped adapter routing for concurrent requests. */
  setRequestBranch(branch: string | null): void {
    this.requestBranch = branch;
    this.syncClientContext();
  }

  getRequestBranch(): string | null {
    return this.requestBranch;
  }

  clearRequestBranch(): void {
    this.requestBranch = null;
    this.syncClientContext();
  }

  private clearManifestFetcherRegistration(): void {
    const registration = this.manifestFetcherRegistration;
    if (!registration) return;

    unregisterManifestFetcherForRelease(registration.releaseId, registration.fetcher);
    this.manifestFetcherRegistration = null;
  }

  private registerManifestFetcher(releaseId: string): void {
    if (!this.manifestClient) return;
    if (this.manifestFetcherRegistration?.releaseId === releaseId) return;

    this.clearManifestFetcherRegistration();
    const fetcher = buildManifestFetcher(this.manifestClient);
    registerManifestFetcherForRelease(releaseId, fetcher);
    this.manifestFetcherRegistration = { releaseId, fetcher };
  }

  setContentContext(context: ResolvedContentContext): void {
    const oldContext = this.contentContext;
    const contextChanged = hasContentContextChanged(oldContext, context);

    logger.debug("setContentContext called", {
      newSourceType: context.sourceType,
      oldSourceType: oldContext?.sourceType,
      contextWillChange: contextChanged,
    });

    const nextReleaseId = context.releaseId;

    if (!nextReleaseId) this.clearManifestFetcherRegistration();
    else this.registerManifestFetcher(nextReleaseId);

    this.contentContext = context;
    this.syncClientContext();

    if (contextChanged) {
      this.statOps.clearIndex();
      this.dirOps.clearTree();
      this.fileListWarmupPromise = null;
      this.fileListWarmupKey = null;
      this.branchMissRecoveryPromise = null;
      this.branchMissRecoveryGeneration++;
      this.branchMissRecoveryFailures.clear();
      logger.debug("Cleared index and dirTree due to context change", {
        oldSourceType: oldContext?.sourceType,
        newSourceType: context.sourceType,
      });
    }

    logger.debug("Content context set complete", {
      sourceType: context.sourceType,
    });
  }

  getContentContext(): ResolvedContentContext | null {
    if (!this.contentContext) {
      logger.warn("getContentContext returning null", {
        initialized: this.initialized,
        hasClient: !!this.client,
      });
    }
    return this.contentContext;
  }

  getClient(): VeryfrontApiClient {
    return this.client;
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    await this.initialize();
  }

  /**
   * Trigger CSS pre-generation for faster first-request latency.
   *
   * Runs CSS extraction and generation in parallel with other initialization.
   * Uses dynamic import to avoid circular dependencies.
   */
  private async triggerCSSPregeneration(
    files: StylePregenerationFile[],
  ): Promise<{ hash: string; assetPath: string } | undefined> {
    const pregenerateStyles = this.styleCallbacks.pregenerateStyles;
    if (!pregenerateStyles) {
      logger.debug("Skipping CSS pre-generation without style callback");
      return undefined;
    }

    try {
      const projectDir = this.normalizer.getProjectDir();
      const result = await pregenerateStyles(files, {
        projectSlug: this.projectSlug,
        projectDir,
        contentContext: this.contentContext,
      });

      if (!result) return undefined;

      logger.debug("CSS pre-generation complete");

      return {
        hash: result.hash,
        assetPath: `/_vf/css/${result.hash}.css`,
      };
    } catch (error) {
      logger.warn("CSS pre-generation failed", {
        errorClass: classifyFilesystemError(error),
      });
      return undefined;
    }
  }
}
