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
} from "./types.ts";
import type { FileInfo, ResolveFileOptions } from "../../base.ts";
import { VeryfrontApiClient } from "../../veryfront-api-client/index.ts";
import type { Project } from "../../veryfront-api-client/index.ts";
import { FileCache } from "../cache/file-cache.ts";
import type { FileCacheOptions } from "../cache/types.ts";
import { PathNormalizer } from "./path-normalizer.ts";
import { ReadOperations } from "./read-operations.ts";
import { DirectoryOperations } from "./directory-operations.ts";
import { StatOperations } from "./stat-operations.ts";
import { buildFileCacheKeyPrefix, buildFileListCacheKey } from "./cache-keys.ts";
import { isPrefixBeingInvalidated } from "./invalidation-state.ts";
import { WebSocketManager } from "./websocket-manager.ts";
import {
  fetchFileListForContext,
  hasContentContextChanged,
  resolveContentContext,
  summarizeFileList,
  toClientContext,
} from "./adapter-content-context.ts";

const logger = baseLogger.component("veryfront-fs-adapter");

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_INITIAL_RETRY_DELAY_MS = 1_000;
const DEFAULT_MAX_RETRY_DELAY_MS = 10_000;
const DEFAULT_CACHE_TTL_MS = 60_000;
const DEFAULT_CACHE_MAX_ENTRIES = 1_000;
const DEFAULT_CACHE_MAX_MEMORY_BYTES = 100 * 1024 * 1024;

export class VeryfrontFSAdapter implements FSAdapter {
  private client: VeryfrontApiClient;
  private cache: FileCache;
  private normalizer: PathNormalizer;
  private readOps: ReadOperations;
  private dirOps: DirectoryOperations;
  private statOps: StatOperations;
  private initialized = false;

  /** Resolves when file list initialization is complete (for coordinating reads) */
  private fileListReadyResolve: (() => void) | null = null;

  private projectData?: Project;
  private apiBaseUrl: string;
  private apiToken: string;
  private projectSlug: string;
  private invalidationCallbacks: InvalidationCallbacks;
  private wsManager: WebSocketManager;

  /** Per-request branch override (for branch preview URLs) */
  private requestBranch: string | null = null;

  /** Content source configuration from config */
  private contentSource: ContentSource;
  /** Resolved content context after initialization (includes resolved releaseId for env/domain) */
  private contentContext: ResolvedContentContext | null = null;
  /** Whether running in proxy mode (shared adapter with per-request OAuth tokens) */
  private proxyMode: boolean;

  constructor(config: FSAdapterConfig) {
    this.invalidationCallbacks = config.invalidationCallbacks ?? {};
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
    this.projectSlug = vf.projectSlug ?? "";
    this.contentSource = vf.contentSource ?? { type: "branch", branch: "main" };
    this.proxyMode = vf.proxyMode ?? false;

    const retryConfig = {
      maxRetries: DEFAULT_MAX_RETRIES,
      initialDelay: DEFAULT_INITIAL_RETRY_DELAY_MS,
      maxDelay: DEFAULT_MAX_RETRY_DELAY_MS,
      ...vf.retry,
    };

    this.client = new VeryfrontApiClient({
      apiBaseUrl: this.apiBaseUrl,
      apiToken: this.apiToken,
      projectSlug: this.projectSlug,
      projectId: vf.projectId,
      proxyMode: vf.proxyMode,
      retry: retryConfig,
    });

    const cacheConfig: FileCacheOptions = {
      enabled: true,
      ttl: DEFAULT_CACHE_TTL_MS,
      maxSize: DEFAULT_CACHE_MAX_ENTRIES,
      maxMemory: DEFAULT_CACHE_MAX_MEMORY_BYTES,
      ...vf.cache,
    };

    this.cache = new FileCache(cacheConfig);
    this.normalizer = new PathNormalizer(config.projectDir);

    const contentContextGetter = {
      isProductionMode: () => this.contentContext?.sourceType !== "branch",
      getReleaseId: () => this.contentContext?.releaseId ?? null,
      getContentContext: () => this.contentContext,
      getFileList: async () => {
        if (!this.contentContext) {
          logger.debug("getFileList: no contentContext");
          return undefined;
        }

        const cacheKey = buildFileListCacheKey(this.contentContext);
        const result = await this.cache.getAsync<
          Array<{
            id?: string;
            path: string;
            content?: string;
            type?: string;
            size?: number;
            updated_at?: string;
          }>
        >(cacheKey);

        logger.debug("getFileList lookup", {
          cacheKey,
          hasResult: !!result,
          resultSize: result?.length ?? 0,
        });

        return result;
      },
      hasCachedFileList: async () => {
        if (!this.contentContext) {
          logger.debug("hasCachedFileList: no contentContext");
          return false;
        }

        const cacheKey = buildFileListCacheKey(this.contentContext);
        const result = await this.cache.getAsync<Array<{ path: string }>>(cacheKey);
        const hasResult = Array.isArray(result) && result.length > 0;

        logger.debug("hasCachedFileList lookup", {
          cacheKey,
          hasResult,
          resultSize: result?.length ?? 0,
        });

        return hasResult;
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
        if (!this.contentContext) {
          logger.debug("getFileListCache: no contentContext");
          return undefined;
        }

        const cacheKey = buildFileListCacheKey(this.contentContext);
        const result = await this.cache.getAsync<Array<{ path: string; content?: string }>>(
          cacheKey,
        );

        logger.debug("getFileListCache lookup", {
          cacheKey,
          hasResult: !!result,
          resultSize: result?.length ?? 0,
          hasContent: result?.filter((f) => f.content)?.length ?? 0,
        });

        return result;
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
        this.readOps.clearFileListIndex();
        this.statOps.clearIndex();
        this.dirOps.clearTree();
      },
      clearFileListIndex: () => this.readOps.clearFileListIndex(),
      setFileListCache: (cacheKey, files) => this.cache.setAsync(cacheKey, files),
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
      this.contentContext = await resolveContentContext(
        this.client,
        this.contentSource,
        this.projectSlug,
      );
      logger.debug("Step 3: resolveContentSource DONE", {
        projectSlug,
        sourceType: this.contentContext.sourceType,
        duration: `${(performance.now() - step3Start).toFixed(2)}ms`,
      });
    } else {
      logger.debug("Step 3: Content context already set", {
        projectSlug,
        sourceType: this.contentContext.sourceType,
      });
    }

    logger.debug("Content context resolved", {
      sourceType: this.contentContext.sourceType,
      projectSlug: this.contentContext.projectSlug,
      branch: this.contentContext.branch,
      environmentName: this.contentContext.environmentName,
      releaseId: this.contentContext.releaseId,
    });

    const cacheKey = buildFileListCacheKey(this.contentContext);
    logger.debug("Step 4: fetchFileList START", { projectSlug, cacheKey });

    try {
      const files = await fetchFileListForContext(this.client, this.contentContext);
      const fileSummary = summarizeFileList(files);

      await this.cache.setAsync(cacheKey, files);

      this.fileListReadyResolve?.();
      this.fileListReadyResolve = null;

      logger.debug("Fetched files during initialization", {
        cacheKey,
        totalFiles: fileSummary.totalFiles,
        filesWithContent: fileSummary.filesWithContent,
        sourceFiles: fileSummary.sourceFiles,
        sourceFilesWithContent: fileSummary.sourceFilesWithContent,
      });

      // Trigger CSS pre-generation for non-branch environments (fire-and-forget)
      // This runs in parallel with the rest of initialization
      if (
        this.contentContext.sourceType !== "branch" &&
        fileSummary.sourceFilesWithContent > 0
      ) {
        this.triggerCSSPregeneration(files).catch(() => {
          // Error already logged in triggerCSSPregeneration
        });
      }

      this.initialized = true;

      logger.debug("initialize COMPLETE", {
        projectSlug,
        fileCount: files.length,
        totalDuration: `${(performance.now() - initStartTime).toFixed(2)}ms`,
      });

      if (this.contentContext.sourceType === "branch") {
        logger.debug("Initialized (branch mode)", {
          projectId: this.client.getProjectId(),
          files: files.length,
          branch: this.contentContext.branch,
          proxyMode: this.proxyMode,
        });
        this.wsManager.connect(projectId);
        return;
      }

      logger.debug("Initialized (published mode)", {
        projectId: this.client.getProjectId(),
        files: files.length,
        sourceType: this.contentContext.sourceType,
        environmentName: this.contentContext.environmentName,
        releaseId: this.contentContext.releaseId,
      });

      // Keep a WebSocket connection in environment mode to receive deployment pokes.
      // Release mode is immutable, so no need to keep a live connection.
      if (this.contentContext.sourceType === "environment") {
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
    return this.readOps.readTextFile(path);
  }

  async readFileBytes(path: string): Promise<Uint8Array> {
    await this.ensureInitialized();
    return this.readOps.readFile(path);
  }

  async readTextFile(path: string): Promise<string> {
    await this.ensureInitialized();
    return this.readOps.readTextFile(path);
  }

  async readdir(path: string): Promise<DirectoryEntry[]> {
    await this.ensureInitialized();
    return this.dirOps.readdir(path);
  }

  async stat(path: string): Promise<FileInfo> {
    await this.ensureInitialized();
    return this.statOps.stat(path);
  }

  async exists(path: string): Promise<boolean> {
    await this.ensureInitialized();
    return this.statOps.exists(path);
  }

  async resolveFile(
    basePath: string,
    options?: ResolveFileOptions,
  ): Promise<string | null> {
    await this.ensureInitialized();
    return this.statOps.resolveFile(basePath, options);
  }

  dispose(): void {
    this.wsManager.dispose();
    this.cache.clear();
    this.statOps.clearIndex();
    this.dirOps.clearTree();
    this.initialized = false;

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
        projectSlug: this.projectSlug,
      });
      return [];
    }

    const cacheKey = buildFileListCacheKey(this.contentContext);
    const files = await this.cache.getAsync<Array<{ path: string; content?: string }>>(cacheKey);

    if (!files?.length) {
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
    if (!this.contentContext) return undefined;

    const normalizedPath = this.normalizer.normalize(path);
    const cacheKey = buildFileListCacheKey(this.contentContext);
    const cachedFiles = this.cache.get(cacheKey) as
      | Array<{ id?: string; path: string }>
      | undefined;

    return cachedFiles?.find((f) => f.path === normalizedPath)?.id;
  }

  getFilePathByEntityId(entityId: string): string | undefined {
    if (!this.contentContext) return undefined;

    const cacheKey = buildFileListCacheKey(this.contentContext);
    const cachedFiles = this.cache.get(cacheKey) as
      | Array<{ id?: string; path: string }>
      | undefined;

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
    this.client.setRequestToken(token);
  }

  clearRequestToken(): void {
    this.client.clearRequestToken();
  }

  setRequestBranch(branch: string | null): void {
    this.requestBranch = branch;
    this.client.setRequestBranch(branch);
  }

  getRequestBranch(): string | null {
    return this.requestBranch;
  }

  clearRequestBranch(): void {
    this.requestBranch = null;
    this.client.clearRequestBranch();
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

    this.contentContext = context;
    this.client.setContext(toClientContext(context));

    if (contextChanged) {
      this.statOps.clearIndex();
      this.dirOps.clearTree();
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

  /**
   * Trigger CSS pre-generation for faster first-request latency.
   *
   * Runs CSS extraction and generation in parallel with other initialization.
   * Uses dynamic import to avoid circular dependencies.
   */
  private async triggerCSSPregeneration(
    files: Array<{ path: string; content?: string }>,
  ): Promise<void> {
    try {
      const { pregenerateCSSFromFiles, findStylesheetFromFiles } = await import(
        "../../../../html/styles-builder/css-pregeneration.ts"
      );

      let stylesheetPath: string | undefined;
      const projectDir = this.normalizer.getProjectDir();

      if (projectDir) {
        try {
          const { runtime } = await import("#veryfront/platform/adapters/registry.ts");
          const { getConfig } = await import("#veryfront/config");
          const adapter = await runtime.get();
          const cacheKey = this.client.getProjectId() || this.projectSlug;
          const config = await getConfig(projectDir, adapter, { cacheKey });
          stylesheetPath = config?.tailwind?.stylesheet;
        } catch (error) {
          logger.debug("Failed to load config for CSS pre-generation", {
            projectSlug: this.projectSlug,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      const stylesheet = findStylesheetFromFiles(files, stylesheetPath);

      await pregenerateCSSFromFiles({
        projectSlug: this.projectSlug,
        files,
        stylesheet,
        stylesheetPath,
        minify: true,
      });
    } catch (error) {
      logger.warn("CSS pre-generation failed", {
        projectSlug: this.projectSlug,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
