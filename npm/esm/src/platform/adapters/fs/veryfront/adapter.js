import { logger } from "../../../../utils/index.js";
import { createVeryfrontConfig } from "./types.js";
import { VeryfrontAPIClient } from "../../veryfront-api-client/index.js";
import { FileCache } from "../cache/file-cache.js";
import { PathNormalizer } from "./path-normalizer.js";
import { ReadOperations } from "./read-operations.js";
import { DirectoryOperations } from "./directory-operations.js";
import { StatOperations } from "./stat-operations.js";
import { buildFileListCacheKey } from "./cache-keys.js";
import { isPrefixBeingInvalidated } from "./invalidation-state.js";
import { buildFileCacheKeyPrefix } from "./cache-keys.js";
import { WebSocketManager } from "./websocket-manager.js";
function isSourceFile(path) {
    return (path.endsWith(".tsx") ||
        path.endsWith(".jsx") ||
        path.endsWith(".mdx") ||
        path.endsWith(".ts") ||
        path.endsWith(".js"));
}
export class VeryfrontFSAdapter {
    client;
    cache;
    normalizer;
    readOps;
    dirOps;
    statOps;
    initialized = false;
    /** Resolves when file list initialization is complete (for coordinating reads) */
    fileListReadyResolve = null;
    /** Rejects when file list initialization fails */
    fileListReadyReject = null;
    projectData;
    apiBaseUrl;
    apiToken;
    projectSlug;
    invalidationCallbacks;
    wsManager;
    /** Per-request branch override (for branch preview URLs) */
    requestBranch = null;
    /** Content source configuration from config */
    contentSource;
    /** Resolved content context after initialization (includes resolved releaseId for env/domain) */
    contentContext = null;
    /** Whether running in proxy mode (shared adapter with per-request OAuth tokens) */
    proxyMode;
    constructor(config) {
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
        this.cache = new FileCache(veryfrontConfig.cache);
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
                const result = await this.cache.getAsync(cacheKey);
                logger.debug("[VeryfrontFSAdapter] getFileList lookup", {
                    cacheKey,
                    hasResult: !!result,
                    resultSize: result?.length ?? 0,
                });
                return result;
            },
            isPersistentCacheInvalidated: (prefix) => this.isPersistentCacheInvalidated(prefix),
            isReleaseBeingInvalidated: (releaseId) => this.isPersistentCacheInvalidated(buildFileCacheKeyPrefix({
                sourceType: "release",
                projectSlug: this.projectSlug,
                releaseId,
            })),
        };
        this.statOps = new StatOperations(this.client, this.cache, this.normalizer, contentContextGetter);
        this.readOps = new ReadOperations(this.client, this.cache, this.normalizer, contentContextGetter, (path) => this.statOps.getOriginalApiPath(path), async () => {
            if (!this.contentContext) {
                logger.debug("[VeryfrontFSAdapter] getFileListCache: no contentContext");
                return undefined;
            }
            const cacheKey = buildFileListCacheKey(this.contentContext);
            const result = await this.cache.getAsync(cacheKey);
            logger.debug("[VeryfrontFSAdapter] getFileListCache lookup", {
                cacheKey,
                hasResult: !!result,
                resultSize: result?.length ?? 0,
                hasContent: result?.filter((f) => f.content)?.length ?? 0,
            });
            return result;
        });
        this.dirOps = new DirectoryOperations(this.client, this.cache, this.normalizer, contentContextGetter);
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
    async initialize() {
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
        const fileListReadyPromise = new Promise((resolve, reject) => {
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
        }
        else {
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
        }
        else {
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
        }
        catch (error) {
            this.fileListReadyReject?.(error instanceof Error ? error : new Error(String(error)));
            this.fileListReadyResolve = null;
            this.fileListReadyReject = null;
            throw error;
        }
    }
    async resolveContentSource() {
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
                if (!lookup)
                    throw new Error(`Domain lookup failed for: ${this.contentSource.domain}`);
                return {
                    sourceType: "environment",
                    projectSlug: lookup.project_slug,
                    environmentName: lookup.environment?.name ?? "production",
                    releaseId: lookup.release_id ?? undefined,
                };
            }
            case "release":
                if (!this.contentSource.releaseId) {
                    throw new Error(`Missing releaseId for release sourceType (project: ${this.projectSlug})`);
                }
                return {
                    sourceType: "release",
                    projectSlug: this.projectSlug,
                    releaseId: this.contentSource.releaseId,
                };
        }
    }
    fetchFileList() {
        if (!this.contentContext)
            throw new Error("Content context not resolved");
        switch (this.contentContext.sourceType) {
            case "branch":
                return this.client.listAllFiles();
            case "environment":
                return this.client.listAllEnvironmentFiles(this.contentContext.environmentName);
            case "release":
                return this.client.listPublishedFiles(undefined, this.contentContext.releaseId);
        }
    }
    isPersistentCacheInvalidated(prefix) {
        return isPrefixBeingInvalidated(prefix);
    }
    getPokeMetrics() {
        return this.wsManager.getPokeMetrics();
    }
    async readFile(path) {
        await this.ensureInitialized();
        return this.readOps.readTextFile(path);
    }
    async readFileBytes(path) {
        await this.ensureInitialized();
        return this.readOps.readFile(path);
    }
    async readTextFile(path) {
        await this.ensureInitialized();
        return this.readOps.readTextFile(path);
    }
    async readdir(path) {
        await this.ensureInitialized();
        return this.dirOps.readdir(path);
    }
    async stat(path) {
        await this.ensureInitialized();
        return this.statOps.stat(path);
    }
    async exists(path) {
        await this.ensureInitialized();
        return this.statOps.exists(path);
    }
    async resolveFile(basePath) {
        await this.ensureInitialized();
        return this.statOps.resolveFile(basePath);
    }
    dispose() {
        this.wsManager.dispose();
        this.cache.clear();
        this.statOps.clearIndex();
        this.dirOps.clearTree();
        this.initialized = false;
        logger.debug("[VeryfrontFSAdapter] Disposed");
    }
    getCacheStats() {
        return { cache: this.cache.stats(), poke: this.getPokeMetrics() };
    }
    getProjectData() {
        return this.projectData;
    }
    async getAllSourceFiles() {
        if (!this.contentContext) {
            logger.debug("[VeryfrontFSAdapter] getAllSourceFiles called without contentContext", {
                initialized: this.initialized,
                projectSlug: this.projectSlug,
            });
            return [];
        }
        const cacheKey = buildFileListCacheKey(this.contentContext);
        const files = await this.cache.getAsync(cacheKey);
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
    getEntityIdForPath(path) {
        if (!this.contentContext)
            return undefined;
        const normalizedPath = this.normalizer.normalize(path);
        const cacheKey = buildFileListCacheKey(this.contentContext);
        const cachedFiles = this.cache.get(cacheKey);
        const file = cachedFiles?.find((f) => f.path === normalizedPath);
        return file?.id;
    }
    getFilePathByEntityId(entityId) {
        if (!this.contentContext)
            return undefined;
        const cacheKey = buildFileListCacheKey(this.contentContext);
        const cachedFiles = this.cache.get(cacheKey);
        return cachedFiles?.find((f) => f.id === entityId)?.path;
    }
    async getFilePathByEntityIdAsync(entityId) {
        const cachedPath = this.getFilePathByEntityId(entityId);
        if (cachedPath)
            return { path: cachedPath };
        logger.debug("[VeryfrontFSAdapter] Fetching file by entity ID from API", { entityId });
        try {
            const file = await this.client.getFileById(entityId);
            if (!file)
                return undefined;
            logger.debug("[VeryfrontFSAdapter] File resolved from API", {
                entityId,
                path: file.path,
                contentLength: file.content.length,
            });
            return { path: file.path, body: file.content };
        }
        catch (error) {
            logger.warn("[VeryfrontFSAdapter] Failed to fetch file by entity ID", {
                entityId,
                error: error instanceof Error ? error.message : String(error),
            });
            return undefined;
        }
    }
    setRequestToken(token) {
        this.client.setRequestToken(token);
    }
    clearRequestToken() {
        this.client.clearRequestToken();
    }
    setRequestBranch(branch) {
        this.requestBranch = branch;
        this.client.setRequestBranch(branch);
    }
    getRequestBranch() {
        return this.requestBranch;
    }
    clearRequestBranch() {
        this.requestBranch = null;
        this.client.clearRequestBranch();
    }
    setContentContext(context) {
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
    getContentContext() {
        if (!this.contentContext) {
            logger.warn("[VeryfrontFSAdapter] getContentContext returning null", {
                projectSlug: this.projectSlug,
                initialized: this.initialized,
                hasClient: !!this.client,
            });
        }
        return this.contentContext;
    }
    getClient() {
        return this.client;
    }
    async ensureInitialized() {
        if (this.initialized)
            return;
        await this.initialize();
    }
    /**
     * Trigger CSS pre-generation for faster first-request latency.
     *
     * Runs CSS extraction and generation in parallel with other initialization.
     * Uses dynamic import to avoid circular dependencies.
     */
    async triggerCSSPregeneration(files) {
        try {
            const { pregenerateCSSFromFiles, findStylesheetFromFiles } = await import("../../../../html/styles-builder/css-pregeneration.js");
            let stylesheetPath;
            const projectDir = this.normalizer.getProjectDir();
            if (projectDir) {
                try {
                    const { runtime } = await import("../../registry.js");
                    const { getConfig } = await import("../../../../config/index.js");
                    const adapter = await runtime.get();
                    const cacheKey = this.client.getProjectId() || this.projectSlug;
                    const config = await getConfig(projectDir, adapter, { cacheKey });
                    stylesheetPath = config?.tailwind?.stylesheet;
                }
                catch (error) {
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
        }
        catch (error) {
            logger.warn("[VeryfrontFSAdapter] CSS pre-generation failed", {
                projectSlug: this.projectSlug,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }
}
