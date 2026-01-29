import { logger } from "#veryfront/utils";
import type {
  CacheStats,
  ContentSource,
  DirectoryEntry,
  FSAdapter,
  FSAdapterConfig,
  InvalidationCallbacks,
  ResolvedContentContext,
} from "./types.ts";
import { createVeryfrontConfig } from "./types.ts";
import type { FileInfo } from "../../base.ts";
import { VeryfrontAPIClient } from "../../veryfront-api-client/index.ts";
import type { Project } from "../../veryfront-api-client/index.ts";
import { FileCache } from "../cache/file-cache.ts";
import type { FileCacheOptions } from "../cache/types.ts";
import { PathNormalizer } from "./path-normalizer.ts";
import { ReadOperations } from "./read-operations.ts";
import { DirectoryOperations } from "./directory-operations.ts";
import { StatOperations } from "./stat-operations.ts";
import { buildFileListCacheKey } from "./cache-keys.ts";
import { isPrefixBeingInvalidated } from "./invalidation-state.ts";
import { buildFileCacheKeyPrefix } from "./cache-keys.ts";
import { WebSocketManager } from "./websocket-manager.ts";

function isSourceFile(path: string): boolean {
  return (
    path.endsWith(".tsx") ||
    path.endsWith(".jsx") ||
    path.endsWith(".mdx") ||
    path.endsWith(".ts") ||
    path.endsWith(".js")
  );
}

export class VeryfrontFSAdapter implements FSAdapter {
  private client: VeryfrontAPIClient;
  private cache: FileCache;
  private normalizer: PathNormalizer;
  private readOps: ReadOperations;
  private dirOps: DirectoryOperations;
  private statOps: StatOperations;
  private initialized = false;

  /** Resolves when file list initialization is complete (for coordinating reads) */
  private fileListReadyResolve: (() => void) | null = null;
  /** Rejects when file list initialization fails */
  private fileListReadyReject: ((error: Error) => void) | null = null;

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
    const veryfrontConfig = createVeryfrontConfig(config);

    this.apiBaseUrl = veryfrontConfig.apiBaseUrl;
    this.apiToken = veryfrontConfig.apiToken;
    this.projectSlug = veryfrontConfig.projectSlug;
    this.contentSource = veryfrontConfig.contentSource;
    this.proxyMode = veryfrontConfig.proxyMode ?? false;

    this.client = new VeryfrontAPIClient({
      apiBaseUrl: veryfrontConfig.apiBaseUrl,
      apiToken: veryfrontConfig.apiToken,
      projectSlug: veryfrontConfig.projectSlug,
      projectId: veryfrontConfig.projectId,
      proxyMode: veryfrontConfig.proxyMode,
      retry: veryfrontConfig.retry,
    });

    this.cache = new FileCache(veryfrontConfig.cache as FileCacheOptions);
    this.normalizer = new PathNormalizer(config.projectDir);

    const contentContextGetter = {
      isProductionMode: () => this.contentContext?.sourceType !== "branch",
      getReleaseId: () => this.contentContext?.releaseId ?? null,
      getContentContext: () => this.contentContext,
      getFileList: async () => {
        if (!this.contentContext) {
          logger.debug("[VeryfrontFSAdapter] getFileList: no contentContext");
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
        logger.debug("[VeryfrontFSAdapter] getFileList lookup", {
          cacheKey,
          hasResult: !!result,
          resultSize: result?.length ?? 0,
        });
        return result;
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
          logger.debug("[VeryfrontFSAdapter] getFileListCache: no contentContext");
          return undefined;
        }
        const cacheKey = buildFileListCacheKey(this.contentContext);
        const result = await this.cache.getAsync<Array<{ path: string; content?: string }>>(
          cacheKey,
        );
        logger.debug("[VeryfrontFSAdapter] getFileListCache lookup", {
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

    logger.debug("[VeryfrontFSAdapter] Created", {
      apiBaseUrl: veryfrontConfig.apiBaseUrl,
      projectSlug: veryfrontConfig.projectSlug,
      projectDir: config.projectDir,
      contentSource: this.contentSource,
      cacheEnabled: veryfrontConfig.cache.enabled,
    });
  }

  async initialize(): Promise<void> {
    const initStartTime = performance.now();
    const projectSlug = this.client.getProjectSlug();

    logger.debug("[VeryfrontFSAdapter] initialize START", {
      projectSlug,
      contentSource: this.contentSource,
      alreadyInitialized: this.initialized,
    });

    if (this.initialized) {
      logger.debug("[VeryfrontFSAdapter] Already initialized, skipping", { projectSlug });
      return;
    }

    const fileListReadyPromise = new Promise<void>((resolve, reject) => {
      this.fileListReadyResolve = resolve;
      this.fileListReadyReject = reject;
    });
    this.readOps.setFileListReadyPromise(fileListReadyPromise);

    logger.debug("[VeryfrontFSAdapter] Step 1: client.initialize START", { projectSlug });
    const step1Start = performance.now();
    await this.client.initialize();
    logger.debug("[VeryfrontFSAdapter] Step 1: client.initialize DONE", {
      projectSlug,
      duration: `${(performance.now() - step1Start).toFixed(2)}ms`,
    });

    const projectId = this.client.getProjectId();
    logger.debug("[VeryfrontFSAdapter] Step 2: getProject START", { projectSlug, projectId });
    const step2Start = performance.now();

    const cachedProject = this.client.getCachedProject();
    if (cachedProject) {
      this.projectData = cachedProject;
      logger.debug("[VeryfrontFSAdapter] Step 2: getProject DONE (from cache)", {
        projectSlug,
        provider: this.projectData.provider,
        layout: this.projectData.layout,
        duration: `${(performance.now() - step2Start).toFixed(2)}ms`,
      });
    } else {
      this.projectData = await this.client.getProject(projectId);
      logger.debug("[VeryfrontFSAdapter] Step 2: getProject DONE (from API)", {
        projectSlug,
        provider: this.projectData.provider,
        layout: this.projectData.layout,
        duration: `${(performance.now() - step2Start).toFixed(2)}ms`,
      });
    }

    if (!this.contentContext) {
      logger.debug("[VeryfrontFSAdapter] Step 3: resolveContentSource START", { projectSlug });
      const step3Start = performance.now();
      this.contentContext = await this.resolveContentSource();
      logger.debug("[VeryfrontFSAdapter] Step 3: resolveContentSource DONE", {
        projectSlug,
        sourceType: this.contentContext.sourceType,
        duration: `${(performance.now() - step3Start).toFixed(2)}ms`,
      });
    } else {
      logger.debug("[VeryfrontFSAdapter] Step 3: Content context already set", {
        projectSlug,
        sourceType: this.contentContext.sourceType,
      });
    }

    logger.debug("[VeryfrontFSAdapter] Content context resolved", {
      sourceType: this.contentContext.sourceType,
      projectSlug: this.contentContext.projectSlug,
      branch: this.contentContext.branch,
      environmentName: this.contentContext.environmentName,
      releaseId: this.contentContext.releaseId,
    });

    const cacheKey = buildFileListCacheKey(this.contentContext);
    logger.debug("[VeryfrontFSAdapter] Step 4: fetchFileList START", { projectSlug, cacheKey });

    try {
      const files = await this.fetchFileList();

      const filesWithContent = files.filter((f) => f.content);
      const sourceFiles = files.filter((f) => isSourceFile(f.path));
      const sourceFilesWithContent = sourceFiles.filter((f) => f.content);

      await this.cache.setAsync(cacheKey, files);

      this.fileListReadyResolve?.();
      this.fileListReadyResolve = null;
      this.fileListReadyReject = null;

      logger.debug("[VeryfrontFSAdapter] Fetched files during initialization", {
        cacheKey,
        totalFiles: files.length,
        filesWithContent: filesWithContent.length,
        sourceFiles: sourceFiles.length,
        sourceFilesWithContent: sourceFilesWithContent.length,
      });

      // Trigger CSS pre-generation for non-branch environments (fire-and-forget)
      // This runs in parallel with the rest of initialization
      if (this.contentContext?.sourceType !== "branch" && sourceFilesWithContent.length > 0) {
        this.triggerCSSPregeneration(files).catch(() => {
          // Error already logged in triggerCSSPregeneration
        });
      }

      this.initialized = true;

      logger.debug("[VeryfrontFSAdapter] initialize COMPLETE", {
        projectSlug,
        fileCount: files.length,
        totalDuration: `${(performance.now() - initStartTime).toFixed(2)}ms`,
      });

      if (this.contentContext.sourceType === "branch") {
        logger.debug("[VeryfrontFSAdapter] Initialized (branch mode)", {
          projectId: this.client.getProjectId(),
          files: files.length,
          branch: this.contentContext.branch,
          proxyMode: this.proxyMode,
        });
        this.wsManager.connect(projectId);
        return;
      }

      logger.debug("[VeryfrontFSAdapter] Initialized (published mode)", {
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
      this.fileListReadyReject?.(error instanceof Error ? error : new Error(String(error)));
      this.fileListReadyResolve = null;
      this.fileListReadyReject = null;
      throw error;
    }
  }

  private async resolveContentSource(): Promise<ResolvedContentContext> {
    switch (this.contentSource.type) {
      case "branch":
        return {
          sourceType: "branch",
          projectSlug: this.projectSlug,
          branch: this.contentSource.branch ?? "main",
        };

      case "environment": {
        const envResult = await this.client.listEnvironmentFiles(this.contentSource.name);
        return {
          sourceType: "environment",
          projectSlug: this.projectSlug,
          environmentName: this.contentSource.name,
          releaseId: envResult.release_id,
        };
      }

      case "domain": {
        const lookup = await this.client.lookupProjectByDomain(this.contentSource.domain);
        if (!lookup) throw new Error(`Domain lookup failed for: ${this.contentSource.domain}`);
        return {
          sourceType: "environment",
          projectSlug: lookup.project_slug,
          environmentName: lookup.environment?.name ?? "production",
          releaseId: lookup.release_id ?? undefined,
        };
      }

      case "release":
        if (!this.contentSource.releaseId) {
          throw new Error(
            `Missing releaseId for release sourceType (project: ${this.projectSlug})`,
          );
        }
        return {
          sourceType: "release",
          projectSlug: this.projectSlug,
          releaseId: this.contentSource.releaseId,
        };
    }
  }

  private fetchFileList(): Promise<Array<{ path: string; content?: string }>> {
    if (!this.contentContext) throw new Error("Content context not resolved");

    switch (this.contentContext.sourceType) {
      case "branch":
        return this.client.listAllFiles();

      case "environment":
        return this.client.listAllEnvironmentFiles(this.contentContext.environmentName!);

      case "release":
        return this.client.listPublishedFiles(undefined, this.contentContext.releaseId);
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

  async resolveFile(basePath: string): Promise<string | null> {
    await this.ensureInitialized();
    return this.statOps.resolveFile(basePath);
  }

  dispose(): void {
    this.wsManager.dispose();
    this.cache.clear();
    this.statOps.clearIndex();
    this.dirOps.clearTree();
    this.initialized = false;

    logger.debug("[VeryfrontFSAdapter] Disposed");
  }

  getCacheStats(): CacheStats {
    return { cache: this.cache.stats(), poke: this.getPokeMetrics() };
  }

  getProjectData(): Project | undefined {
    return this.projectData;
  }

  async getAllSourceFiles(): Promise<Array<{ path: string; content?: string }>> {
    if (!this.contentContext) {
      logger.debug("[VeryfrontFSAdapter] getAllSourceFiles called without contentContext", {
        initialized: this.initialized,
        projectSlug: this.projectSlug,
      });
      return [];
    }

    const cacheKey = buildFileListCacheKey(this.contentContext);
    const files = await this.cache.getAsync<Array<{ path: string; content?: string }>>(cacheKey);

    if (!files?.length) {
      logger.debug("[VeryfrontFSAdapter] getAllSourceFiles cache miss or empty", {
        cacheKey,
        initialized: this.initialized,
        hasFiles: !!files,
        fileCount: files?.length ?? 0,
      });
      return [];
    }

    const filesWithContent = files.filter((f) => f.content);
    const sourceFiles = files.filter((f) => isSourceFile(f.path));
    const sourceFilesWithContent = sourceFiles.filter((f) => f.content);

    logger.debug("[VeryfrontFSAdapter] getAllSourceFiles returning", {
      cacheKey,
      totalFiles: files.length,
      filesWithContent: filesWithContent.length,
      sourceFiles: sourceFiles.length,
      sourceFilesWithContent: sourceFilesWithContent.length,
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
    const file = cachedFiles?.find((f) => f.path === normalizedPath);
    return file?.id;
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

    logger.debug("[VeryfrontFSAdapter] Fetching file by entity ID from API", { entityId });
    try {
      const file = await this.client.getFileById(entityId);
      if (!file) return undefined;

      logger.debug("[VeryfrontFSAdapter] File resolved from API", {
        entityId,
        path: file.path,
        contentLength: file.content.length,
      });

      return { path: file.path, body: file.content };
    } catch (error) {
      logger.warn("[VeryfrontFSAdapter] Failed to fetch file by entity ID", {
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
    const contextChanged = !oldContext ||
      oldContext.sourceType !== context.sourceType ||
      oldContext.projectSlug !== context.projectSlug ||
      oldContext.branch !== context.branch ||
      oldContext.environmentName !== context.environmentName ||
      oldContext.releaseId !== context.releaseId;

    logger.debug("[VeryfrontFSAdapter] setContentContext called", {
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

    switch (context.sourceType) {
      case "branch":
        this.client.setContext({ type: "branch", name: context.branch ?? "main" });
        break;
      case "environment":
        this.client.setContext({
          type: "environment",
          name: context.environmentName ?? "production",
        });
        break;
      case "release":
        this.client.setContext({ type: "release", version: context.releaseId ?? "" });
        break;
    }

    if (contextChanged) {
      this.statOps.clearIndex();
      this.dirOps.clearTree();
      logger.debug("[VeryfrontFSAdapter] Cleared index and dirTree due to context change", {
        oldContext,
        newContext: context,
      });
    }

    logger.debug("[VeryfrontFSAdapter] Content context set complete", {
      sourceType: context.sourceType,
      projectSlug: context.projectSlug,
    });
  }

  getContentContext(): ResolvedContentContext | null {
    if (!this.contentContext) {
      logger.warn("[VeryfrontFSAdapter] getContentContext returning null", {
        projectSlug: this.projectSlug,
        initialized: this.initialized,
        hasClient: !!this.client,
      });
    }
    return this.contentContext;
  }

  getClient(): VeryfrontAPIClient {
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
          logger.debug("[VeryfrontFSAdapter] Failed to load config for CSS pre-generation", {
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
      logger.warn("[VeryfrontFSAdapter] CSS pre-generation failed", {
        projectSlug: this.projectSlug,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
