import { logger as baseLogger } from "#veryfront/utils";
import { createError, toError } from "#veryfront/errors";
import type {
  CacheStats,
  ContentSource,
  DirectoryEntry,
  FSAdapter,
  FSAdapterConfig,
  InvalidationCallbacks,
  ResolvedContentContext,
  StyleCallbacks,
  StylePregenerationFile,
} from "./types.ts";
import type { FileInfo, ResolveFileOptions } from "../../base.ts";
import { VeryfrontApiClient } from "../../veryfront-api-client/index.ts";
import type { Project } from "../../veryfront-api-client/index.ts";
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
  DEFAULT_CACHE_TTL_MS,
  shouldBackgroundPregenerateStyles,
} from "./adapter-helpers.ts";
import { isNotFoundLikeError } from "./read-operations-helpers.ts";
import { DEFAULT_VERYFRONT_API_SUCCESS_BODY_BYTES } from "../../veryfront-api-transport.ts";
import { requireBoundedFileReadLimit } from "../../bounded-file-read.ts";

import {
  clearCachedReleaseAssetManifests,
  registerManifestFetcherForRelease,
  type ReleaseAssetManifestFetcher,
  type ReleaseAssetManifestFetcherCleanup,
} from "#veryfront/release-assets/manifest-cache.ts";

const logger = baseLogger.component("veryfront-fs-adapter");
const BRANCH_MISS_RECOVERY_FAILURE_TTL_MS = 5_000;
const BRANCH_SOURCE_SNAPSHOT_FRESHNESS_MS = 30_000;
// Process-wide uniqueness prevents a recreated adapter from matching stale
// derived-state generations left behind by its predecessor.
let sourceSnapshotGeneration = 0;

function nextSourceSnapshotGeneration(): number {
  if (sourceSnapshotGeneration >= Number.MAX_SAFE_INTEGER) {
    throw new RangeError("Source snapshot generation space is exhausted");
  }
  sourceSnapshotGeneration++;
  return sourceSnapshotGeneration;
}

interface SourceSnapshotFile {
  path: string;
  id?: string;
  version_id?: string;
  content?: string;
  type?: string;
  size?: number;
  updated_at?: string;
}

function sourceSnapshotsEqual(
  previous: SourceSnapshotFile[] | undefined,
  next: SourceSnapshotFile[],
): boolean {
  if (!previous || previous.length !== next.length) return false;

  const previousByPath = new Map(previous.map((file) => [file.path, file]));
  return next.every((file) => {
    const prior = previousByPath.get(file.path);
    return prior !== undefined &&
      prior.id === file.id &&
      prior.version_id === file.version_id &&
      prior.content === file.content &&
      prior.type === file.type &&
      prior.size === file.size &&
      prior.updated_at === file.updated_at;
  });
}

interface BranchSnapshotRecoveryOptions<T> {
  isRecoverableMissResult?: (result: T) => boolean;
  requirePendingSourceInvalidation?: boolean;
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
): ReleaseAssetManifestFetcher {
  return (releaseId: string, context) =>
    client.getReleaseAssetManifest(releaseId, undefined, context.signal);
}

export class VeryfrontFSAdapter implements FSAdapter {
  readonly maxWholeFileReadBytes = DEFAULT_VERYFRONT_API_SUCCESS_BODY_BYTES;
  readonly symlinkSemantics = "none" as const;
  readonly projectContextSemantics: "fixed" | undefined;
  private client: VeryfrontApiClient;
  private cache: FileCache;
  private normalizer: PathNormalizer;
  private readOps: ReadOperations;
  private dirOps: DirectoryOperations;
  private statOps: StatOperations;
  private initialized = false;
  private exactReadInitializationPromise: Promise<void> | null = null;
  private exactReadInitializationGeneration = 0;

  /** Resolves when file list initialization is complete (for coordinating reads) */
  private fileListReadyResolve: (() => void) | null = null;
  /** Single-flight background rewarm when the file list cache disappears */
  // Resolves with the files it fetched, so a caller that waited does not have
  // to depend on the cache write having succeeded -- writes are skipped
  // entirely when caching is disabled, and can fail on a backend cache.
  private fileListWarmupPromise: Promise<Array<{ path: string; content?: string }> | null> | null =
    null;
  private fileListWarmupKey: string | null = null;
  /**
   * Last listing this adapter fetched or was poked with, kept in memory because
   * a cache write is not guaranteed to retain it: writes are skipped entirely
   * when caching is disabled, oversized listings are dropped by the memory
   * cache, and backend writes can fail. Without this, every module lookup of a
   * render would miss the cache and await its own full listing fetch -- more
   * API traffic than the per-file probing this replaced. It expires with the
   * same TTL as the cache entry it stands in for and is dropped by every
   * invalidation, so it is never fresher or staler than a retained cache write.
   */
  private retainedFileList:
    | {
      cacheKey: string;
      files: Array<{ path: string; content?: string }>;
      snapshotVersion: number;
      retainedAt: number;
    }
    | null = null;
  private readonly fileListRetentionMs: number;
  /** Single-flight foreground refresh when a branch preview read misses a newly pushed file. */
  private branchMissRecoveryPromise: Promise<void> | null = null;
  private branchMissRecoveryGeneration = 0;
  private readonly branchMissRecoveryFailures = new Map<string, number>();
  /** Last successful source check and generation of the materialized snapshot. */
  private sourceSnapshotCheckedAt = 0;
  private sourceSnapshotVersion = nextSourceSnapshotGeneration();
  private sourceSnapshotIdentity: string | undefined;
  private sourceSnapshotFiles: SourceSnapshotFile[] | undefined;
  private sourceSnapshotRefreshPromise: Promise<void> | null = null;
  private sourceSnapshotMutationTail: Promise<void> = Promise.resolve();

  private projectData?: Project;
  private apiBaseUrl: string;
  private apiToken: string;
  private activeRequestToken: string;
  private projectSlug: string;
  private invalidationCallbacks: InvalidationCallbacks;
  private styleCallbacks: StyleCallbacks;
  private wsManager: WebSocketManager;
  private manifestFetcherCleanup: ReleaseAssetManifestFetcherCleanup | null = null;

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

  private getCurrentSourceSnapshotIdentity(): string | undefined {
    const context = this.contentContext;
    if (!context) return undefined;

    switch (context.sourceType) {
      case "branch":
        return `branch:${context.projectSlug}:${this.requestBranch ?? context.branch ?? "main"}`;
      case "environment":
        return `environment:${context.projectSlug}:${context.environmentName ?? ""}:${
          context.releaseId ?? ""
        }`;
      case "release":
        return `release:${context.projectSlug}:${context.releaseId ?? ""}`;
    }
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

  private getCachedFileListSync<T extends { path: string; id?: string }>(): T[] | undefined {
    const cacheKey = this.getCurrentFileListCacheKey();
    if (!cacheKey) return undefined;
    return this.cache.get(cacheKey) as T[] | undefined;
  }

  private async getCachedFileListAsync<T extends { path: string }>(
    noContextMessage: string,
    lookupLabel: string,
    missReason: string,
    options: { waitForWarmup?: boolean } = {},
  ): Promise<{ cacheKey: string; files: T[] | undefined } | undefined> {
    const cacheKey = this.getCurrentFileListCacheKey();
    if (!cacheKey) {
      logger.debug(noContextMessage);
      return undefined;
    }

    let files = await this.cache.getAsync<T[]>(cacheKey);
    logger.debug(`${lookupLabel} lookup`, {
      cacheKey,
      hasResult: !!files,
      resultSize: files?.length ?? 0,
      hasContent: (files as Array<{ content?: string }> | undefined)?.filter((file) =>
        !!file.content
      )?.length ?? 0,
    });

    if (files === undefined) {
      files = this.readRetainedFileList<T>(cacheKey);
    }

    if (files === undefined) {
      this.scheduleFileListWarmup(missReason, cacheKey);
      if (options.waitForWarmup) {
        files = await this.awaitFileListWarmup<T>(cacheKey) ?? files;
      }
    }

    return { cacheKey, files };
  }

  /** Keep `files` answerable from memory for as long as a cache write would. */
  private retainFileList(
    cacheKey: string,
    files: Array<{ path: string; content?: string }>,
  ): void {
    this.retainedFileList = {
      cacheKey,
      files,
      snapshotVersion: this.sourceSnapshotVersion,
      retainedAt: Date.now(),
    };
  }

  private clearRetainedFileList(): void {
    this.retainedFileList = null;
  }

  /**
   * The retained listing, if it still describes the snapshot the caller is
   * reading. Anything that supersedes the snapshot -- a poke, a refresh, a
   * branch or token change -- either drops it outright or moves the snapshot
   * version past it, so a superseded listing can never answer a read.
   */
  private readRetainedFileList<T extends { path: string }>(
    cacheKey: string,
  ): T[] | undefined {
    const retained = this.retainedFileList;
    if (!retained) return undefined;

    if (
      retained.cacheKey !== cacheKey ||
      retained.snapshotVersion !== this.sourceSnapshotVersion
    ) {
      this.clearRetainedFileList();
      return undefined;
    }

    if (Date.now() - retained.retainedAt > this.fileListRetentionMs) {
      logger.debug("Retained file list expired", { cacheKey });
      this.clearRetainedFileList();
      return undefined;
    }

    return retained.files as T[];
  }

  /**
   * Wait for the in-flight file-list warmup for `cacheKey` and return the
   * fetched listing. SSR module resolution reads this list for every module of
   * a page; when the cached listing has expired, answering "no list" makes each
   * module fall back to its own per-file/per-extension API probing (dozens of
   * sequential fetches per render). Paying for one awaited listing fetch keeps
   * that fan-out at a single API call while staying exactly as fresh: the
   * listing is fetched from the API at request time. Warmup failures resolve to
   * undefined so callers keep the legacy per-file fallback.
   */
  private async awaitFileListWarmup<T extends { path: string }>(
    cacheKey: string,
  ): Promise<T[] | undefined> {
    const warmupPromise = this.fileListWarmupPromise;
    if (!warmupPromise || this.fileListWarmupKey !== cacheKey) return undefined;

    const fetched = await warmupPromise;
    return fetched === null ? undefined : (fetched as T[]);
  }

  constructor(config: FSAdapterConfig) {
    this.invalidationCallbacks = config.invalidationCallbacks ?? {};
    this.styleCallbacks = config.styleCallbacks ?? {};
    const vf = config.veryfront;
    if (!vf) {
      throw toError(
        createError({
          type: "config",
          message: "Veryfront adapter requires veryfront configuration",
        }),
      );
    }

    this.apiBaseUrl = vf.apiBaseUrl ?? "";
    this.apiToken = vf.apiToken ?? "";
    this.activeRequestToken = this.apiToken;
    this.projectSlug = vf.projectSlug ?? "";
    this.contentSource = vf.contentSource ?? { type: "branch", branch: "main" };
    this.proxyMode = vf.proxyMode ?? false;
    this.projectContextSemantics = this.proxyMode ? undefined : "fixed";

    const retryConfig = buildRetryConfig(vf.retry);

    this.client = new VeryfrontApiClient({
      apiBaseUrl: this.apiBaseUrl,
      apiToken: this.apiToken,
      projectSlug: this.projectSlug,
      projectId: vf.projectId,
      proxyMode: vf.proxyMode,
      retry: retryConfig,
    });

    const cacheConfig = buildFileCacheOptions(vf.cache);

    this.cache = new FileCache(cacheConfig);
    this.fileListRetentionMs = cacheConfig.ttl ?? DEFAULT_CACHE_TTL_MS;
    this.normalizer = new PathNormalizer(config.projectDir);
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
        }>("getFileList: no contentContext", "getFileList", "getFileList miss", {
          waitForWarmup: true,
        });
        return cached?.files;
      },
      hasCachedFileList: async () => {
        const cached = await this.getCachedFileListAsync<{ path: string }>(
          "hasCachedFileList: no contentContext",
          "hasCachedFileList",
          "hasCachedFileList miss",
          { waitForWarmup: true },
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
          { waitForWarmup: true },
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
      clearMemoryCaches: () => this.clearMemoryCaches(),
      getSourceSnapshotVersion: () => this.sourceSnapshotVersion,
      replaceSourceSnapshot: (cacheKey, files, expectedSnapshotVersion) =>
        this.replaceSourceSnapshot(cacheKey, files, expectedSnapshotVersion),
      pregenerateStyles: (files) => this.triggerCSSPregeneration(files),
    });

    logger.debug("Created", {
      apiBaseUrl: this.apiBaseUrl,
      projectSlug: this.projectSlug,
      projectDir: config.projectDir,
      contentSource: this.contentSource,
      cacheEnabled: cacheConfig.enabled,
    });
  }

  async initialize(): Promise<void> {
    const initStartTime = performance.now();
    const projectSlug = this.client.getProjectSlug();

    logger.debug("initialize START", {
      projectSlug,
      contentSource: this.contentSource,
      alreadyInitialized: this.initialized,
    });

    if (this.initialized) {
      logger.debug("Already initialized, skipping", { projectSlug });
      return;
    }

    const fileListReadyPromise = new Promise<void>((resolve) => {
      this.fileListReadyResolve = resolve;
    });
    this.readOps.setFileListReadyPromise(fileListReadyPromise);

    logger.debug("Step 1: client.initialize START", { projectSlug });
    const step1Start = performance.now();
    await this.client.initialize();
    logger.debug("Step 1: client.initialize DONE", {
      projectSlug,
      duration: `${(performance.now() - step1Start).toFixed(2)}ms`,
    });

    const projectId = this.client.getProjectId();
    logger.debug("Step 2: getProject START", { projectSlug, projectId });
    const step2Start = performance.now();

    const cachedProject = this.client.getCachedProject();
    this.projectData = cachedProject ?? (await this.client.getProject(projectId));

    logger.debug(
      `[VeryfrontFSAdapter] Step 2: getProject DONE (${cachedProject ? "from cache" : "from API"})`,
      {
        projectSlug,
        provider: this.projectData.provider,
        layout: this.projectData.layout,
        duration: `${(performance.now() - step2Start).toFixed(2)}ms`,
      },
    );

    if (!this.contentContext) {
      logger.debug("Step 3: resolveContentSource START", { projectSlug });
      const step3Start = performance.now();
      const resolvedContext = await resolveContentContext(
        this.client,
        this.contentSource,
        this.projectSlug,
      );
      this.setContentContext(resolvedContext);
      logger.debug("Step 3: resolveContentSource DONE", {
        projectSlug,
        sourceType: resolvedContext.sourceType,
        duration: `${(performance.now() - step3Start).toFixed(2)}ms`,
      });
    } else {
      logger.debug("Step 3: Content context already set", {
        projectSlug,
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
      projectSlug: contentContext.projectSlug,
      branch: contentContext.branch,
      environmentName: contentContext.environmentName,
      releaseId: contentContext.releaseId,
    });

    const cacheKey = buildFileListCacheKey(contentContext);
    const initializationIdentity = this.getCurrentSourceSnapshotIdentity();
    const initializationSnapshotVersion = this.sourceSnapshotVersion;
    logger.debug("Step 4: fetchFileList START", { projectSlug, cacheKey });

    try {
      const files = await fetchFileListForContext(this.client, contentContext);
      const fileSummary = summarizeFileList(files);

      const initialSnapshotApplied = await this.runSourceSnapshotMutation(async () => {
        const isSnapshotSuperseded = () =>
          this.contentContext !== contentContext ||
          this.getCurrentSourceSnapshotIdentity() !== initializationIdentity ||
          this.sourceSnapshotVersion !== initializationSnapshotVersion;
        if (isSnapshotSuperseded()) return false;

        await this.cache.setAsync(cacheKey, files);
        if (isSnapshotSuperseded()) {
          await this.cache.deleteAsync(cacheKey);
          return false;
        }

        this.markSourceSnapshotChanged(files, initializationIdentity);
        // Retain after the generation bump so the first read can reuse the
        // initialized snapshot even when the configured cache keeps nothing.
        this.retainFileList(cacheKey, files);
        return true;
      });

      this.fileListReadyResolve?.();
      this.fileListReadyResolve = null;

      logger.debug(
        initialSnapshotApplied
          ? "Fetched files during initialization"
          : "Discarded initialization files superseded by a newer source snapshot",
        {
          cacheKey,
          totalFiles: fileSummary.totalFiles,
          filesWithContent: fileSummary.filesWithContent,
          sourceFiles: fileSummary.sourceFiles,
          sourceFilesWithContent: fileSummary.sourceFilesWithContent,
        },
      );

      // Trigger CSS pre-generation after the initial file snapshot is ready for
      // published contexts. Branch previews should first try remote metadata
      // recovery on cold starts instead of repopulating the prepared cache here.
      if (
        initialSnapshotApplied &&
        fileSummary.sourceFilesWithContent > 0 &&
        this.shouldBackgroundPregenerateStyles()
      ) {
        this.triggerCSSPregeneration(files).catch(() => {
          // Error already logged in triggerCSSPregeneration
        });
      }

      this.initialized = true;

      logger.debug("initialize COMPLETE", {
        projectSlug,
        fileCount: initialSnapshotApplied ? files.length : 0,
        totalDuration: `${(performance.now() - initStartTime).toFixed(2)}ms`,
      });

      const initializedContext = this.contentContext;
      if (initializedContext?.sourceType === "branch") {
        logger.debug("Initialized (branch mode)", {
          projectId: this.client.getProjectId(),
          files: initialSnapshotApplied ? files.length : 0,
          branch: initializedContext.branch,
          proxyMode: this.proxyMode,
        });
        this.wsManager.connect(projectId);
        return;
      }

      logger.debug("Initialized (published mode)", {
        projectId: this.client.getProjectId(),
        files: initialSnapshotApplied ? files.length : 0,
        sourceType: initializedContext?.sourceType,
        environmentName: initializedContext?.environmentName,
        releaseId: initializedContext?.releaseId,
      });

      // Keep a WebSocket connection in environment mode to receive deployment pokes.
      // Release mode is immutable, so no need to keep a live connection.
      if (initializedContext?.sourceType === "environment") {
        this.wsManager.connect(projectId);
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
          path: this.normalizer.normalize(path),
          projectSlug: this.projectSlug,
          branch: this.requestBranch ?? this.contentContext?.branch,
          error: refreshError instanceof Error ? refreshError.message : String(refreshError),
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
          path: this.normalizer.normalize(path),
          projectSlug: this.projectSlug,
          branch: this.requestBranch ?? this.contentContext?.branch,
          error: refreshError instanceof Error ? refreshError.message : String(refreshError),
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
        reason,
        cacheKey: effectiveCacheKey,
      });
      return;
    }

    const warmupContext = this.contentContext;
    const warmupSnapshotVersion = this.sourceSnapshotVersion;
    let warmupPromise: Promise<Array<{ path: string; content?: string }> | null> | null = null;
    warmupPromise = (async () => {
      try {
        const existing = await this.cache.getAsync<Array<{ path: string; content?: string }>>(
          effectiveCacheKey,
        );

        if (existing !== undefined) {
          logger.debug("Skipping file list warmup because cache is already populated", {
            reason,
            cacheKey: effectiveCacheKey,
            fileCount: existing.length,
          });
          return existing;
        }

        logger.debug("Starting file list warmup", {
          reason,
          cacheKey: effectiveCacheKey,
          sourceType: warmupContext.sourceType,
          branch: warmupContext.branch,
          environmentName: warmupContext.environmentName,
          releaseId: warmupContext.releaseId,
        });

        const files = await fetchFileListForContext(this.client, warmupContext);

        // A WebSocket snapshot can land while this fetch is open. Publishing
        // the pre-poke listing would roll both the cache and this caller's
        // answer back to the older draft, so the write is serialized against
        // snapshot mutations and stands down when one won the race.
        const applied = await this.runSourceSnapshotMutation(async () => {
          if (
            this.contentContext !== warmupContext ||
            this.sourceSnapshotVersion !== warmupSnapshotVersion
          ) {
            return false;
          }

          await this.cache.setAsync(effectiveCacheKey, files);
          // A poke can advance the generation while a distributed cache write
          // is pending. Remove the value that just landed before releasing the
          // mutation lock, so neither this waiter nor a later read sees it.
          if (
            this.contentContext !== warmupContext ||
            this.sourceSnapshotVersion !== warmupSnapshotVersion
          ) {
            await this.cache.deleteAsync(effectiveCacheKey);
            return false;
          }
          this.retainFileList(effectiveCacheKey, files);
          return true;
        });

        if (!applied) {
          logger.debug("Discarding file list warmup superseded by a newer source snapshot", {
            reason,
            cacheKey: effectiveCacheKey,
          });

          // Answer with the snapshot that superseded this fetch rather than
          // the listing it carries, so the caller stays as fresh as the poke.
          return await this.cache.getAsync<Array<{ path: string; content?: string }>>(
            effectiveCacheKey,
          ) ?? this.readRetainedFileList<{ path: string; content?: string }>(effectiveCacheKey) ??
            null;
        }

        const fileSummary = summarizeFileList(files);

        if (fileSummary.sourceFilesWithContent > 0 && this.shouldBackgroundPregenerateStyles()) {
          this.triggerCSSPregeneration(files).catch(() => {
            // Error already logged in triggerCSSPregeneration
          });
        }

        logger.debug("File list warmup complete", {
          reason,
          cacheKey: effectiveCacheKey,
          totalFiles: files.length,
          filesWithContent: files.filter((file) => file.content).length,
        });

        return files;
      } catch (error) {
        logger.warn("File list warmup failed", {
          reason,
          cacheKey: effectiveCacheKey,
          error: error instanceof Error ? error.message : String(error),
        });

        return null;
      } finally {
        if (warmupPromise && this.fileListWarmupPromise === warmupPromise) {
          this.fileListWarmupPromise = null;
          this.fileListWarmupKey = null;
        }
      }
    })();

    this.fileListWarmupPromise = warmupPromise;
    this.fileListWarmupKey = effectiveCacheKey;
    // That collaborator only needs completion, not the payload.
    this.readOps.setFileListReadyPromise(warmupPromise.then(() => {}));
  }

  /**
   * Drop every in-memory view of the current source snapshot. Used by pokes
   * that invalidate without carrying replacement files inline, so the next read
   * re-derives everything from the API rather than from a superseded listing.
   */
  private clearMemoryCaches(): void {
    clearCachedReleaseAssetManifests();
    // An accepted poke may clear memory before its debounced replacement
    // listing arrives. Advance the generation immediately so an older warmup
    // cannot repopulate the cache or answer a waiting read in that window.
    this.sourceSnapshotVersion = nextSourceSnapshotGeneration();
    this.clearRetainedFileList();
    this.readOps.clearFileListIndex();
    this.statOps.clearIndex();
    this.dirOps.clearTree();
  }

  private markSourceSnapshotChanged(
    files: SourceSnapshotFile[],
    identity = this.getCurrentSourceSnapshotIdentity(),
  ): void {
    this.sourceSnapshotFiles = files;
    this.sourceSnapshotIdentity = identity;
    this.sourceSnapshotVersion = nextSourceSnapshotGeneration();
    this.sourceSnapshotCheckedAt = Date.now();
  }

  private runSourceSnapshotMutation<T>(operation: () => Promise<T>): Promise<T> {
    const mutation = this.sourceSnapshotMutationTail
      .catch(() => undefined)
      .then(operation);
    this.sourceSnapshotMutationTail = mutation.then(
      () => undefined,
      () => undefined,
    );
    return mutation;
  }

  private replaceSourceSnapshot(
    cacheKey: string,
    files: SourceSnapshotFile[],
    expectedSnapshotVersion = this.sourceSnapshotVersion,
  ): Promise<number | undefined> {
    const expectedContext = this.contentContext;
    return this.runSourceSnapshotMutation(async () => {
      if (
        !expectedContext ||
        this.contentContext !== expectedContext ||
        this.sourceSnapshotVersion !== expectedSnapshotVersion ||
        buildFileListCacheKey(expectedContext) !== cacheKey
      ) {
        logger.debug("Discarding superseded source snapshot", {
          cacheKey,
          projectSlug: this.projectSlug,
        });
        return undefined;
      }

      await this.cache.setAsync(cacheKey, files);
      if (
        this.contentContext !== expectedContext ||
        this.sourceSnapshotVersion !== expectedSnapshotVersion
      ) {
        // A newer poke invalidated this replacement while its distributed
        // cache write was pending. Remove the value that just landed and leave
        // memory empty so the next read derives the newer snapshot.
        await this.cache.deleteAsync(cacheKey);
        return undefined;
      }
      this.readOps.clearFileListIndex();
      this.markSourceSnapshotChanged(files);
      // Retain after the version bump so the poked listing -- not the one it
      // replaced -- is what later reads see when the cache keeps nothing.
      this.retainFileList(cacheKey, files);
      return this.sourceSnapshotVersion;
    });
  }

  private async invalidateDerivedSourceCaches(): Promise<void> {
    const projectId = this.client.getProjectId();
    const invalidations: Array<void | Promise<void>> = [];

    if (projectId) {
      invalidations.push(
        this.invalidationCallbacks.clearSSRModuleCacheForProject?.(projectId),
        this.invalidationCallbacks.clearRouterDetectionCacheForProject?.(projectId),
        this.invalidationCallbacks.clearProjectDiscoveryCacheForProject?.(projectId),
        this.invalidationCallbacks.clearRendererCacheForProject?.(projectId),
      );
    } else {
      invalidations.push(this.invalidationCallbacks.clearSSRModuleCache?.());
    }

    invalidations.push(this.invalidationCallbacks.clearModulePathCache?.());
    if (this.projectSlug) {
      invalidations.push(
        this.invalidationCallbacks.clearSnippetCacheForProject?.(this.projectSlug),
        this.invalidationCallbacks.clearProjectCSSCache?.(this.projectSlug),
      );
    }

    const pendingInvalidations = invalidations.filter(
      (invalidation): invalidation is Promise<void> => invalidation !== undefined,
    );
    if (pendingInvalidations.length > 0) {
      await Promise.all(pendingInvalidations);
    }
  }

  private async performSourceSnapshotRefresh(reason: string): Promise<void> {
    await this.ensureInitialized();

    if (!this.contentContext) {
      logger.debug("Skipping source snapshot refresh without content context", {
        reason,
        projectSlug: this.projectSlug,
      });
      return;
    }

    const cacheKey = buildFileListCacheKey(this.contentContext);
    const refreshContext = this.contentContext;
    const refreshIdentity = this.getCurrentSourceSnapshotIdentity();
    const previousFiles = this.sourceSnapshotFiles;
    const previousVersion = this.sourceSnapshotVersion;
    const files = await fetchFileListForContext(this.client, refreshContext);
    const result = await this.runSourceSnapshotMutation(async () => {
      const isSnapshotSuperseded = () =>
        this.contentContext !== refreshContext ||
        this.getCurrentSourceSnapshotIdentity() !== refreshIdentity ||
        this.sourceSnapshotVersion !== previousVersion;
      if (isSnapshotSuperseded()) {
        return { applied: false, sourceChanged: false };
      }

      const sourceChanged = !sourceSnapshotsEqual(previousFiles, files);
      if (sourceChanged) {
        this.fileListWarmupPromise = null;
        this.fileListWarmupKey = null;
        this.clearRetainedFileList();
        this.readOps.clearFileListIndex();
        this.statOps.clearIndex();
        this.dirOps.clearTree();

        await Promise.all([
          this.cache.deleteByPrefixAsync(buildFileCacheKeyPrefix(refreshContext)),
          this.cache.deleteByPrefixAsync(buildStatCacheKeyPrefix(refreshContext)),
          this.cache.deleteByPrefixAsync(buildDirCacheKeyPrefix(refreshContext)),
          this.cache.deleteAsync(cacheKey),
        ]);
        if (isSnapshotSuperseded()) {
          return { applied: false, sourceChanged: false };
        }
      }

      await this.cache.setAsync(cacheKey, files);
      if (isSnapshotSuperseded()) {
        await this.cache.deleteAsync(cacheKey);
        return { applied: false, sourceChanged: false };
      }

      if (sourceChanged) {
        await this.invalidateDerivedSourceCaches();
        if (isSnapshotSuperseded()) {
          await this.cache.deleteAsync(cacheKey);
          return { applied: false, sourceChanged: false };
        }
        // Publish freshness only after every cache derived from the previous
        // snapshot has been invalidated. Concurrent followers remain attached
        // to the refresh singleflight until this point.
        this.markSourceSnapshotChanged(files, refreshIdentity);
      } else {
        this.sourceSnapshotFiles = files;
        this.sourceSnapshotIdentity = refreshIdentity;
        this.sourceSnapshotCheckedAt = Date.now();
      }

      this.branchMissRecoveryFailures.clear();
      this.retainFileList(cacheKey, files);

      return { applied: true, sourceChanged };
    });

    if (!result.applied) {
      logger.debug("Discarding stale source snapshot refresh", {
        reason,
        cacheKey,
        projectSlug: this.projectSlug,
      });
      return;
    }

    const fileSummary = summarizeFileList(files);

    if (
      result.sourceChanged &&
      fileSummary.sourceFilesWithContent > 0 &&
      this.shouldBackgroundPregenerateStyles()
    ) {
      this.triggerCSSPregeneration(files).catch(() => {
        // Error already logged in triggerCSSPregeneration
      });
    }

    logger.info("Refreshed source snapshot", {
      reason,
      cacheKey,
      projectSlug: this.projectSlug,
      sourceType: refreshContext.sourceType,
      branch: refreshContext.branch,
      environmentName: refreshContext.environmentName,
      releaseId: refreshContext.releaseId,
      totalFiles: fileSummary.totalFiles,
      filesWithContent: fileSummary.filesWithContent,
      sourceChanged: result.sourceChanged,
      sourceSnapshotVersion: this.sourceSnapshotVersion,
    });
  }

  async refreshSourceSnapshot(reason = "manual-refresh"): Promise<void> {
    await this.ensureInitialized();

    while (true) {
      this.sourceSnapshotRefreshPromise ??= this.performSourceSnapshotRefresh(reason);
      const refresh = this.sourceSnapshotRefreshPromise;

      try {
        await refresh;
      } finally {
        if (this.sourceSnapshotRefreshPromise === refresh) {
          this.sourceSnapshotRefreshPromise = null;
        }
      }

      const currentIdentity = this.getCurrentSourceSnapshotIdentity();
      if (
        currentIdentity === undefined ||
        this.sourceSnapshotIdentity === currentIdentity
      ) return;
    }
  }

  async ensureSourceSnapshotFresh(reason = "freshness-check"): Promise<void> {
    await this.ensureInitialized();
    if (this.contentContext?.sourceType !== "branch") return;

    if (
      this.sourceSnapshotIdentity === this.getCurrentSourceSnapshotIdentity() &&
      Date.now() - this.sourceSnapshotCheckedAt < BRANCH_SOURCE_SNAPSHOT_FRESHNESS_MS
    ) {
      return;
    }

    await this.refreshSourceSnapshot(reason);
  }

  getSourceSnapshotVersion(): number {
    return this.sourceSnapshotVersion;
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

  async readFileBytesWithinLimit(path: string, byteLimit: number): Promise<Uint8Array> {
    const admittedLimit = requireBoundedFileReadLimit(byteLimit);
    await this.ensureExactReadInitialized();
    return this.withBranchSnapshotRecovery(
      path,
      () => this.readOps.readFileBytesWithinLimit(path, admittedLimit),
    );
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
    this.sourceSnapshotVersion = nextSourceSnapshotGeneration();
    this.wsManager.dispose();
    this.manifestFetcherCleanup?.();
    this.manifestFetcherCleanup = null;
    this.cache.clear();
    this.statOps.clearIndex();
    this.dirOps.clearTree();
    this.initialized = false;
    this.exactReadInitializationPromise = null;
    this.exactReadInitializationGeneration++;
    this.fileListWarmupPromise = null;
    this.fileListWarmupKey = null;
    this.clearRetainedFileList();
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

  /**
   * @param options.waitForWarmup wait for an in-flight file-list fetch instead
   * of answering empty. Off by default: most callers can proceed without the
   * list and must not pay for the fetch, but a caller that has no other way to
   * obtain it -- CSP derivation on a release-backed context, where nothing else
   * populates the cache -- would otherwise read empty on every request forever.
   */
  async getAllSourceFiles(
    options: { waitForWarmup?: boolean } = {},
  ): Promise<Array<{ path: string; content?: string }>> {
    if (!this.contentContext) {
      logger.debug("getAllSourceFiles called without contentContext", {
        initialized: this.initialized,
        projectSlug: this.projectSlug,
      });
      return [];
    }

    const cached = await this.getCachedFileListAsync<{ path: string; content?: string }>(
      "getAllSourceFiles: no contentContext",
      "getAllSourceFiles",
      "getAllSourceFiles miss",
    );
    const cacheKey = cached?.cacheKey;
    let files = cached?.files;

    // A miss schedules a warmup and returns immediately, which is right for
    // callers that can proceed without the list. This one cannot: nothing else
    // populates it for a release-backed context, so returning early meant the
    // list was empty on every request for the life of the process. Wait for the
    // fetch this read just started, then look again.
    if (options.waitForWarmup && cacheKey && files === undefined && this.fileListWarmupPromise) {
      // Take what the fetch returned rather than re-reading the cache: with
      // caching disabled, or a failed backend write, the cache keeps nothing
      // and correctness would depend on a write that never happened.
      const fetched = await this.fileListWarmupPromise;
      files = fetched !== null
        ? fetched
        : await this.cache.getAsync<{ path: string; content?: string }[]>(cacheKey);
    }

    if (!cacheKey || !files?.length) {
      logger.debug("getAllSourceFiles cache miss or empty", {
        cacheKey,
        initialized: this.initialized,
        hasFiles: !!files,
        fileCount: files?.length ?? 0,
      });
      return [];
    }

    const fileSummary = summarizeFileList(files);

    logger.debug("getAllSourceFiles returning", {
      cacheKey,
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

    logger.debug("Fetching file by entity ID from API", { entityId });

    try {
      const file = await this.client.getFileById(entityId);
      if (!file) return undefined;

      logger.debug("File resolved from API", {
        entityId,
        path: file.path,
        contentLength: file.content.length,
      });

      return { path: file.path, body: file.content };
    } catch (error) {
      logger.warn("Failed to fetch file by entity ID", {
        entityId,
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }

  setRequestToken(token: string): void {
    if (token !== this.activeRequestToken) {
      this.activeRequestToken = token;
      this.invalidateRequestAuthoritySnapshot();
    }
    this.client.setRequestToken(token);
    this.wsManager.setApiToken(token);
  }

  clearRequestToken(): void {
    if (this.activeRequestToken !== this.apiToken) {
      this.activeRequestToken = this.apiToken;
      this.invalidateRequestAuthoritySnapshot();
    }
    this.client.clearRequestToken();
    this.wsManager.setApiToken(this.apiToken);
  }

  private invalidateRequestAuthoritySnapshot(): void {
    this.cache.clear();
    this.clearRetainedFileList();
    this.readOps.clearFileListIndex();
    this.statOps.clearIndex();
    this.dirOps.clearTree();
    this.fileListWarmupPromise = null;
    this.fileListWarmupKey = null;
    this.branchMissRecoveryPromise = null;
    this.branchMissRecoveryGeneration++;
    this.branchMissRecoveryFailures.clear();
    this.sourceSnapshotCheckedAt = 0;
    this.sourceSnapshotVersion = nextSourceSnapshotGeneration();
    this.sourceSnapshotRefreshPromise = null;
    this.sourceSnapshotIdentity = undefined;
    this.sourceSnapshotFiles = undefined;
  }

  setRequestBranch(branch: string | null): void {
    if (branch !== this.requestBranch) {
      this.sourceSnapshotVersion = nextSourceSnapshotGeneration();
    }
    this.requestBranch = branch;
    this.syncClientContext();
  }

  getRequestBranch(): string | null {
    return this.requestBranch;
  }

  clearRequestBranch(): void {
    if (this.requestBranch !== null) {
      this.sourceSnapshotVersion = nextSourceSnapshotGeneration();
    }
    this.requestBranch = null;
    this.syncClientContext();
  }

  setContentContext(context: ResolvedContentContext): void {
    const oldContext = this.contentContext;
    const contextChanged = hasContentContextChanged(oldContext, context);

    logger.debug("setContentContext called", {
      newSourceType: context.sourceType,
      newProjectSlug: context.projectSlug,
      newBranch: context.branch,
      newReleaseId: context.releaseId,
      newEnvironmentName: context.environmentName,
      oldSourceType: oldContext?.sourceType,
      oldBranch: oldContext?.branch,
      oldReleaseId: oldContext?.releaseId,
      contextWillChange: contextChanged,
    });

    const nextReleaseId = context.releaseId;

    this.manifestFetcherCleanup?.();
    this.manifestFetcherCleanup = null;

    // Register a per-releaseId manifest fetcher so production HTML can
    // consult ready manifests when the feature flag is on. Using the per-
    // releaseId registry ensures the correct project-scoped token is always
    // used, even under multi-tenant / proxy-manager operation.
    if (nextReleaseId) {
      this.manifestFetcherCleanup = registerManifestFetcherForRelease(
        nextReleaseId,
        buildManifestFetcher(this.client),
      );
    }

    this.contentContext = context;
    this.syncClientContext();

    if (contextChanged) {
      this.statOps.clearIndex();
      this.dirOps.clearTree();
      this.fileListWarmupPromise = null;
      this.fileListWarmupKey = null;
      this.clearRetainedFileList();
      this.branchMissRecoveryPromise = null;
      this.branchMissRecoveryGeneration++;
      this.branchMissRecoveryFailures.clear();
      this.sourceSnapshotCheckedAt = 0;
      this.sourceSnapshotVersion = nextSourceSnapshotGeneration();
      this.sourceSnapshotIdentity = undefined;
      this.sourceSnapshotFiles = undefined;
      this.sourceSnapshotRefreshPromise = null;
      logger.debug("Cleared index and dirTree due to context change", {
        oldContext,
        newContext: context,
      });
    }

    logger.debug("Content context set complete", {
      sourceType: context.sourceType,
      projectSlug: context.projectSlug,
    });
  }

  getContentContext(): ResolvedContentContext | null {
    if (!this.contentContext) {
      logger.warn("getContentContext returning null", {
        projectSlug: this.projectSlug,
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

  private async ensureExactReadInitialized(): Promise<void> {
    if (this.client.isInitialized() && this.contentContext) return;
    if (this.exactReadInitializationPromise) {
      await this.exactReadInitializationPromise;
      return;
    }

    const generation = ++this.exactReadInitializationGeneration;
    const initialization = (async () => {
      await this.client.initialize();
      if (!this.contentContext) {
        this.setContentContext(
          await resolveContentContext(this.client, this.contentSource, this.projectSlug),
        );
      }
      if (!this.contentContext) {
        throw toError(
          createError({
            type: "config",
            message: "Veryfront adapter content context resolution failed",
          }),
        );
      }
    })();
    this.exactReadInitializationPromise = initialization;
    try {
      await initialization;
    } finally {
      if (this.exactReadInitializationGeneration === generation) {
        this.exactReadInitializationPromise = null;
      }
    }
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
      logger.debug("Skipping CSS pre-generation without style callback", {
        projectSlug: this.projectSlug,
      });
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

      logger.debug("CSS pre-generation complete", {
        projectSlug: this.projectSlug,
        cssHash: result.hash,
      });

      return {
        hash: result.hash,
        assetPath: `/_vf/css/${result.hash}.css`,
      };
    } catch (error) {
      logger.warn("CSS pre-generation failed", {
        projectSlug: this.projectSlug,
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }
}
