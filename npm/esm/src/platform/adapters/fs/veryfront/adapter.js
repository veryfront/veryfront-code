import * as dntShim from "../../../../../_dnt.shims.js";
import { logger } from "../../../../utils/index.js";
import { createVeryfrontConfig } from "./types.js";
import { VeryfrontAPIClient } from "../../veryfront-api-client/index.js";
import { FileCache } from "../cache/file-cache.js";
import { PathNormalizer } from "./path-normalizer.js";
import { ReadOperations } from "./read-operations.js";
import { DirectoryOperations } from "./directory-operations.js";
import { StatOperations } from "./stat-operations.js";
import { buildDirCacheKeyPrefix, buildFileCacheKeyPrefix, buildFileListCacheKey, buildStatCacheKeyPrefix, } from "./cache-keys.js";
import { addPendingInvalidation, getPendingInvalidationsCount, isPrefixBeingInvalidated, removePendingInvalidation, } from "./invalidation-state.js";
const INVALIDATION_DEBOUNCE_MS = 100;
const WS_RECONNECT_DELAY_MS = 5000;
const WS_HEARTBEAT_INTERVAL_MS = 60000;
const WS_HEARTBEAT_TIMEOUT_MS = 300000;
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
    ws = null;
    wsReconnectTimer = null;
    wsHeartbeatTimer = null;
    wsLastPong = Date.now();
    invalidationTimer = null;
    selectiveInvalidationTimer = null;
    pendingChangedPaths = new Set();
    apiBaseUrl;
    apiToken;
    projectSlug;
    invalidationCallbacks;
    /** Per-request branch override (for branch preview URLs) */
    requestBranch = null;
    /** WebSocket connection identity for observability */
    wsConnectionId = null;
    /** Poke notification metrics for observability */
    pokeMetrics = {
        received: 0,
        invalidationsTriggered: 0,
        lastPokeTime: 0,
    };
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
                this.connectWebSocket(projectId);
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
                this.connectWebSocket(projectId);
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
    connectWebSocket(projectId) {
        this.cleanupWebSocketTimers();
        const wsUrl = this.apiBaseUrl
            .replace(/^http:/, "ws:")
            .replace(/^https:/, "wss:")
            .replace(/\/api$/, "");
        const url = `${wsUrl}/ws/${projectId}/events?token=${this.apiToken}`;
        logger.debug("[VeryfrontFSAdapter] Connecting to WebSocket", {
            url: url.replace(this.apiToken, "***"),
        });
        try {
            this.ws = new WebSocket(url);
            this.wsConnectionId = dntShim.crypto.randomUUID().slice(0, 8);
            this.ws.onopen = () => {
                logger.debug("[VeryfrontFSAdapter] WebSocket connected to events channel", {
                    projectId,
                    connectionId: this.wsConnectionId,
                    contentSource: this.contentSource,
                    branch: this.contentContext?.branch,
                });
                this.wsLastPong = Date.now();
                this.startHeartbeat(projectId);
            };
            this.ws.onmessage = (event) => {
                this.wsLastPong = Date.now();
                logger.debug("[VeryfrontFSAdapter] WebSocket message received:", { data: event.data });
                try {
                    const data = JSON.parse(event.data);
                    const changedPaths = data.data?.changedPaths;
                    const isPoke = data.type === "poke" || data.type === "entity_updated";
                    if (!isPoke)
                        return;
                    // Extract branch scope from poke to determine environment matching
                    // branchName is preferred (matches preview subdomain); branchId is a fallback
                    const pokeBranchId = data.data?.branchId;
                    const pokeBranchName = data.data?.branchName;
                    const normalizedBranchId = typeof pokeBranchId === "string" && pokeBranchId.length > 0
                        ? pokeBranchId
                        : null;
                    const normalizedBranchName = typeof pokeBranchName === "string" && pokeBranchName.length > 0 ? pokeBranchName : null;
                    const timeSinceLastPoke = this.pokeMetrics.lastPokeTime > 0
                        ? Date.now() - this.pokeMetrics.lastPokeTime
                        : null;
                    this.pokeMetrics.received++;
                    this.pokeMetrics.lastPokeTime = Date.now();
                    // Environment-scoped invalidation: only process pokes relevant to our mode
                    const isProductionMode = this.contentContext?.sourceType !== "branch";
                    const currentBranch = this.contentContext?.branch ?? null;
                    const hasBranchScope = !!normalizedBranchName || !!normalizedBranchId;
                    const isProductionPoke = !hasBranchScope;
                    logger.debug("[VeryfrontFSAdapter] POKE RECEIVED - checking environment scope", {
                        type: data.type,
                        pokeBranchId: normalizedBranchId,
                        pokeBranchName: normalizedBranchName,
                        isProductionPoke,
                        isProductionMode,
                        currentBranch,
                        entityId: data.data?.entityId,
                        entityType: data.data?.entityType,
                        action: data.data?.action,
                        connectionId: this.wsConnectionId,
                        totalPokesReceived: this.pokeMetrics.received,
                        timeSinceLastPokeMs: timeSinceLastPoke,
                    });
                    // In production mode, we accept branch-scoped pokes too.
                    // Production renders always fetch published content, so clearing caches
                    // on preview edits is safe and avoids stale content after publish.
                    if (isProductionMode && !isProductionPoke) {
                        logger.debug("[VeryfrontFSAdapter] POKE ACCEPTED - branch-scoped poke in production mode", {
                            pokeBranchId: normalizedBranchId,
                            pokeBranchName: normalizedBranchName,
                            sourceType: this.contentContext?.sourceType,
                        });
                    }
                    if (!isProductionMode) {
                        if (normalizedBranchName) {
                            if (normalizedBranchName !== currentBranch) {
                                logger.debug("[VeryfrontFSAdapter] POKE SKIPPED - different branch name in preview mode", {
                                    pokeBranchName: normalizedBranchName,
                                    currentBranch,
                                });
                                return;
                            }
                        }
                        else if (normalizedBranchId) {
                            if (currentBranch === null) {
                                logger.debug("[VeryfrontFSAdapter] POKE SKIPPED - branchId-only poke for main preview", { pokeBranchId: normalizedBranchId });
                                return;
                            }
                            logger.debug("[VeryfrontFSAdapter] POKE ACCEPTED - branchId-only fallback in preview mode", { pokeBranchId: normalizedBranchId, currentBranch });
                        }
                        else if (currentBranch !== null && currentBranch !== "main") {
                            // Unscoped pokes (no branchId/branchName) are for main branch edits.
                            // Skip only if we're on a named branch (not main).
                            // For main preview (currentBranch === "main"), accept unscoped pokes.
                            logger.debug("[VeryfrontFSAdapter] POKE SKIPPED - unscoped poke for named branch preview", { currentBranch });
                            return;
                        }
                    }
                    // Extract deployment-specific data for targeted cache invalidation
                    const pokeReleaseId = data.data?.releaseId;
                    const normalizedPokeReleaseId = typeof pokeReleaseId === "string" && pokeReleaseId.length > 0 ? pokeReleaseId : null;
                    const isDeploymentPoke = data.data?.entityType === "deployment";
                    const isPublishPoke = isDeploymentPoke || (isProductionMode && !changedPaths?.length);
                    const pokeEnvironmentName = data.data?.environmentName;
                    const normalizedPokeEnvironment = typeof pokeEnvironmentName === "string" && pokeEnvironmentName.length > 0
                        ? pokeEnvironmentName
                        : this.contentContext?.environmentName ??
                            (isProductionMode ? "production" : undefined);
                    logger.info("[VeryfrontFSAdapter] POKE ACCEPTED - triggering cache invalidation", {
                        changedPathsCount: changedPaths?.length || 0,
                        changedPaths: changedPaths || [],
                        projectSlug: this.projectSlug,
                        branch: this.contentContext?.branch,
                        isDeploymentPoke,
                        isPublishPoke,
                        pokeReleaseId: normalizedPokeReleaseId,
                        pokeEnvironmentName: normalizedPokeEnvironment,
                    });
                    // Clear in-memory caches immediately (before debounce) for fresh data
                    this.invalidationCallbacks.clearDomainCache?.();
                    this.readOps.clearFileListIndex();
                    this.statOps.clearIndex();
                    this.dirOps.clearTree();
                    logger.debug("[VeryfrontFSAdapter] All in-memory caches cleared immediately on POKE");
                    // Clear persistent cache for publish/deployment pokes to prevent stale hits
                    if (isPublishPoke && this.projectSlug) {
                        const deletionPrefixes = new Set();
                        const pendingPrefixes = new Set();
                        const addContextPrefixes = (ctx) => {
                            const filePrefix = buildFileCacheKeyPrefix(ctx);
                            const statPrefix = buildStatCacheKeyPrefix(ctx);
                            const dirPrefix = buildDirCacheKeyPrefix(ctx);
                            const filesPrefix = buildFileListCacheKey(ctx);
                            deletionPrefixes.add(filePrefix);
                            deletionPrefixes.add(statPrefix);
                            deletionPrefixes.add(dirPrefix);
                            deletionPrefixes.add(filesPrefix);
                            // Track ALL prefixes as pending to prevent stale reads during async deletion
                            pendingPrefixes.add(filePrefix);
                            pendingPrefixes.add(statPrefix);
                            pendingPrefixes.add(dirPrefix);
                            pendingPrefixes.add(filesPrefix);
                        };
                        const addBroadPrefixes = (sourceType) => {
                            const sourceKey = sourceType === "release" ? "release" : "env";
                            const base = `${sourceKey}:${this.projectSlug}:`;
                            deletionPrefixes.add(`file:${base}`);
                            deletionPrefixes.add(`stat:${base}`);
                            deletionPrefixes.add(`dir:${base}`);
                            deletionPrefixes.add(`files:${base}`);
                            // Track ALL prefixes as pending to prevent stale reads during async deletion
                            pendingPrefixes.add(`file:${base}`);
                            pendingPrefixes.add(`stat:${base}`);
                            pendingPrefixes.add(`dir:${base}`);
                            pendingPrefixes.add(`files:${base}`);
                        };
                        if (normalizedPokeReleaseId) {
                            addContextPrefixes({
                                sourceType: "release",
                                projectSlug: this.projectSlug,
                                releaseId: normalizedPokeReleaseId,
                            });
                            if (normalizedPokeEnvironment) {
                                addContextPrefixes({
                                    sourceType: "environment",
                                    projectSlug: this.projectSlug,
                                    environmentName: normalizedPokeEnvironment,
                                    releaseId: normalizedPokeReleaseId,
                                });
                            }
                        }
                        else {
                            // Fallback: clear all env/release caches for this project
                            addBroadPrefixes("release");
                            addBroadPrefixes("environment");
                        }
                        for (const prefix of pendingPrefixes) {
                            addPendingInvalidation(prefix);
                        }
                        logger.info("[VeryfrontFSAdapter] PUBLISH POKE - clearing persistent cache", {
                            projectSlug: this.projectSlug,
                            releaseId: normalizedPokeReleaseId,
                            environmentName: normalizedPokeEnvironment,
                            deletionPrefixes: Array.from(deletionPrefixes),
                            pendingPrefixes: Array.from(pendingPrefixes),
                            pendingInvalidations: getPendingInvalidationsCount(),
                        });
                        void (async () => {
                            try {
                                const results = await Promise.all(Array.from(deletionPrefixes).map((prefix) => this.cache.deleteByPrefixAsync(prefix)));
                                const totalDeleted = results.reduce((sum, count) => sum + count, 0);
                                logger.info("[VeryfrontFSAdapter] PUBLISH POKE - persistent cache cleared", {
                                    projectSlug: this.projectSlug,
                                    releaseId: normalizedPokeReleaseId,
                                    environmentName: normalizedPokeEnvironment,
                                    totalDeleted,
                                });
                            }
                            catch (error) {
                                logger.warn("[VeryfrontFSAdapter] PUBLISH POKE - failed to clear persistent cache", {
                                    projectSlug: this.projectSlug,
                                    releaseId: normalizedPokeReleaseId,
                                    environmentName: normalizedPokeEnvironment,
                                    error: error instanceof Error ? error.message : String(error),
                                });
                            }
                            finally {
                                for (const prefix of pendingPrefixes) {
                                    removePendingInvalidation(prefix);
                                }
                                logger.debug("[VeryfrontFSAdapter] PUBLISH POKE - cache invalidation complete", {
                                    projectSlug: this.projectSlug,
                                    pendingInvalidations: getPendingInvalidationsCount(),
                                });
                            }
                        })();
                    }
                    if (changedPaths?.length) {
                        this.scheduleSelectiveInvalidation(changedPaths);
                        return;
                    }
                    logger.debug("[VeryfrontFSAdapter] No changedPaths provided - using full invalidation");
                    this.scheduleInvalidation();
                }
                catch (error) {
                    logger.debug("[VeryfrontFSAdapter] WebSocket message parse error", { error: error });
                }
            };
            this.ws.onclose = () => {
                logger.debug("[VeryfrontFSAdapter] WebSocket closed, reconnecting", {
                    delayMs: WS_RECONNECT_DELAY_MS,
                    connectionId: this.wsConnectionId,
                    totalPokesReceived: this.pokeMetrics.received,
                });
                this.wsConnectionId = null;
                this.cleanupWebSocketTimers();
                this.wsReconnectTimer = dntShim.setTimeout(() => this.connectWebSocket(projectId), WS_RECONNECT_DELAY_MS);
            };
            this.ws.onerror = (error) => {
                logger.warn("[VeryfrontFSAdapter] WebSocket error", { error });
            };
        }
        catch (error) {
            logger.warn("[VeryfrontFSAdapter] Failed to connect WebSocket", { error });
            this.wsReconnectTimer = dntShim.setTimeout(() => this.connectWebSocket(projectId), WS_RECONNECT_DELAY_MS);
        }
    }
    isPersistentCacheInvalidated(prefix) {
        return isPrefixBeingInvalidated(prefix);
    }
    startHeartbeat(projectId) {
        this.wsHeartbeatTimer = dntShim.setInterval(() => {
            const timeSinceLastPong = Date.now() - this.wsLastPong;
            if (timeSinceLastPong <= WS_HEARTBEAT_TIMEOUT_MS)
                return;
            logger.warn("[VeryfrontFSAdapter] WebSocket heartbeat timeout, reconnecting", {
                timeSinceLastPong,
            });
            if (this.ws) {
                try {
                    this.ws.close();
                }
                catch {
                    // Ignore close errors
                }
            }
            this.cleanupWebSocketTimers();
            this.connectWebSocket(projectId);
        }, WS_HEARTBEAT_INTERVAL_MS);
    }
    cleanupWebSocketTimers() {
        if (this.wsHeartbeatTimer) {
            clearInterval(this.wsHeartbeatTimer);
            this.wsHeartbeatTimer = null;
        }
        if (this.wsReconnectTimer) {
            clearTimeout(this.wsReconnectTimer);
            this.wsReconnectTimer = null;
        }
    }
    scheduleInvalidation() {
        if (this.invalidationTimer)
            clearTimeout(this.invalidationTimer);
        logger.debug("[VeryfrontFSAdapter] Scheduling invalidation", {
            debounceMs: INVALIDATION_DEBOUNCE_MS,
        });
        this.invalidationTimer = dntShim.setTimeout(() => {
            this.invalidationTimer = null;
            this.performInvalidation();
        }, INVALIDATION_DEBOUNCE_MS);
    }
    scheduleSelectiveInvalidation(changedPaths) {
        for (const path of changedPaths)
            this.pendingChangedPaths.add(path);
        if (this.selectiveInvalidationTimer)
            clearTimeout(this.selectiveInvalidationTimer);
        logger.debug("[VeryfrontFSAdapter] Scheduling selective invalidation", {
            newPaths: changedPaths.length,
            totalPending: this.pendingChangedPaths.size,
            debounceMs: INVALIDATION_DEBOUNCE_MS,
        });
        this.selectiveInvalidationTimer = dntShim.setTimeout(() => {
            this.selectiveInvalidationTimer = null;
            this.performSelectiveInvalidation();
        }, INVALIDATION_DEBOUNCE_MS);
    }
    async performSelectiveInvalidation() {
        const startTime = Date.now();
        const changedPaths = Array.from(this.pendingChangedPaths);
        this.pendingChangedPaths.clear();
        logger.debug("[VeryfrontFSAdapter] Performing selective invalidation", {
            changedPaths,
            count: changedPaths.length,
        });
        const sourceTypes = ["branch:", "release:", "env:"];
        const fileTypes = ["file:", "stat:"];
        const parentDirs = new Set();
        const deletionPromises = [];
        for (const path of changedPaths) {
            const slashIndex = path.lastIndexOf("/");
            parentDirs.add(slashIndex > 0 ? path.substring(0, slashIndex) : "");
            for (const fileType of fileTypes) {
                for (const sourceType of sourceTypes) {
                    deletionPromises.push(this.cache.deleteByPrefixAndSuffixAsync(fileType + sourceType, path));
                }
            }
        }
        for (const parentDir of parentDirs) {
            for (const sourceType of sourceTypes) {
                deletionPromises.push(this.cache.deleteByPrefixAndSuffixAsync("dir:" + sourceType, parentDir));
            }
        }
        await Promise.all(deletionPromises);
        logger.debug("[VeryfrontFSAdapter] Cache entries deleted for changed paths", {
            changedPaths,
            parentDirs: Array.from(parentDirs),
            prefixes: ["file:", "stat:", "dir:"],
        });
        this.invalidationCallbacks.invalidateModulePaths?.(changedPaths);
        const projectId = this.client.getProjectId();
        logger.debug("[VeryfrontFSAdapter] Clearing SSR module cache for HMR", {
            changedPaths,
            projectId,
            usePerProject: !!this.invalidationCallbacks.clearSSRModuleCacheForProject,
        });
        if (this.invalidationCallbacks.clearSSRModuleCacheForProject && projectId) {
            this.invalidationCallbacks.clearSSRModuleCacheForProject(projectId);
        }
        else {
            this.invalidationCallbacks.clearSSRModuleCache?.();
        }
        // Await renderer cache clear to prevent race condition with HMR
        if (this.invalidationCallbacks.clearRendererCacheForProject && projectId) {
            await this.invalidationCallbacks.clearRendererCacheForProject(projectId);
        }
        // No global fallback — clearRendererCache is deprecated due to multi-tenant blast radius.
        // Invalidate project CSS cache when source files change
        if (this.invalidationCallbacks.clearProjectCSSCache && this.projectSlug) {
            this.invalidationCallbacks.clearProjectCSSCache(this.projectSlug);
        }
        if (this.contentContext?.sourceType === "branch") {
            await this.cache.deleteByPrefixAsync("files:branch:");
            try {
                const files = await this.client.listAllFiles();
                const cacheKey = buildFileListCacheKey(this.contentContext);
                await this.cache.setAsync(cacheKey, files);
                // File list index is also cleared immediately on POKE receipt (before debounce).
                // This call is a redundant safety net after fresh files are cached.
                this.readOps.clearFileListIndex();
                logger.debug("[VeryfrontFSAdapter] Fresh files cached (memory + Redis)", {
                    cacheKey,
                    fileCount: files.length,
                });
            }
            catch (error) {
                logger.warn("[VeryfrontFSAdapter] Failed to fetch files during selective invalidation", {
                    error,
                });
            }
        }
        this.pokeMetrics.invalidationsTriggered++;
        logger.info("[VeryfrontFSAdapter] TRIGGERING HMR RELOAD via invalidationCallbacks.triggerReload", {
            changedPaths,
            projectSlug: this.projectSlug,
            projectId: this.client.getProjectId(),
            hasTriggerReloadCallback: !!this.invalidationCallbacks.triggerReload,
        });
        const environment = this.contentContext?.sourceType === "branch"
            ? "preview"
            : "production";
        const projectContext = {
            projectSlug: this.projectSlug,
            projectId: this.client.getProjectId(),
            environment,
            branch: this.contentContext?.branch ?? null,
            releaseId: this.contentContext?.releaseId ?? null,
        };
        this.invalidationCallbacks.triggerReload?.(changedPaths, projectContext);
        logger.info("[VeryfrontFSAdapter] Selective invalidation complete - HMR triggered", {
            changedPaths,
            durationMs: Date.now() - startTime,
            totalInvalidations: this.pokeMetrics.invalidationsTriggered,
        });
        this.sendPokeAck("selective", changedPaths);
    }
    async performInvalidation() {
        const startTime = Date.now();
        logger.debug("[VeryfrontFSAdapter] CACHE INVALIDATION STARTED - clearing all caches");
        const [fileBranchCount, fileReleaseCount, fileEnvCount, statBranchCount, statReleaseCount, statEnvCount, dirBranchCount, dirReleaseCount, dirEnvCount, filesBranchCount, filesReleaseCount, filesEnvCount,] = await Promise.all([
            this.cache.deleteByPrefixAsync("file:branch:"),
            this.cache.deleteByPrefixAsync("file:release:"),
            this.cache.deleteByPrefixAsync("file:env:"),
            this.cache.deleteByPrefixAsync("stat:branch:"),
            this.cache.deleteByPrefixAsync("stat:release:"),
            this.cache.deleteByPrefixAsync("stat:env:"),
            this.cache.deleteByPrefixAsync("dir:branch:"),
            this.cache.deleteByPrefixAsync("dir:release:"),
            this.cache.deleteByPrefixAsync("dir:env:"),
            this.cache.deleteByPrefixAsync("files:branch:"),
            this.cache.deleteByPrefixAsync("files:release:"),
            this.cache.deleteByPrefixAsync("files:env:"),
        ]);
        // These caches are also cleared immediately on POKE receipt (before debounce).
        // These calls are redundant safety nets for the full invalidation flow.
        this.statOps.clearIndex();
        this.dirOps.clearTree();
        this.invalidationCallbacks.clearDomainCache?.();
        const projectId = this.client.getProjectId();
        const projectDir = this.normalizer.getProjectDir();
        if (this.invalidationCallbacks.clearSSRModuleCacheForProject && projectId) {
            this.invalidationCallbacks.clearSSRModuleCacheForProject(projectId);
        }
        else {
            this.invalidationCallbacks.clearSSRModuleCache?.();
        }
        if (this.invalidationCallbacks.clearRouterDetectionCacheForProject && projectDir) {
            this.invalidationCallbacks.clearRouterDetectionCacheForProject(projectDir);
        }
        else {
            this.invalidationCallbacks.clearRouterDetectionCache?.();
        }
        this.invalidationCallbacks.clearModulePathCache?.();
        if (this.invalidationCallbacks.clearSnippetCacheForProject && this.projectSlug) {
            this.invalidationCallbacks.clearSnippetCacheForProject(this.projectSlug);
        }
        else {
            this.invalidationCallbacks.clearSnippetCache?.();
        }
        // Await renderer cache clear to prevent race condition with HMR
        if (this.invalidationCallbacks.clearRendererCacheForProject && projectId) {
            await this.invalidationCallbacks.clearRendererCacheForProject(projectId);
        }
        // No global fallback — clearRendererCache is deprecated due to multi-tenant blast radius.
        // Invalidate project CSS cache on full cache clear
        if (this.invalidationCallbacks.clearProjectCSSCache && this.projectSlug) {
            this.invalidationCallbacks.clearProjectCSSCache(this.projectSlug);
        }
        const totalFileCount = fileBranchCount + fileReleaseCount + fileEnvCount;
        const totalStatCount = statBranchCount + statReleaseCount + statEnvCount;
        const totalDirCount = dirBranchCount + dirReleaseCount + dirEnvCount;
        const totalFilesListCount = filesBranchCount + filesReleaseCount + filesEnvCount;
        logger.debug("[VeryfrontFSAdapter] CACHES CLEARED (memory + Redis)", {
            fileCacheCleared: totalFileCount,
            statCacheCleared: totalStatCount,
            dirCacheCleared: totalDirCount,
            filesListCacheCleared: totalFilesListCount,
        });
        if (this.contentContext?.sourceType === "branch") {
            try {
                const files = await this.client.listAllFiles();
                const cacheKey = buildFileListCacheKey(this.contentContext);
                await this.cache.setAsync(cacheKey, files);
                this.readOps.clearFileListIndex();
                logger.debug("[VeryfrontFSAdapter] FRESH FILES FETCHED", {
                    cacheKey,
                    fileCount: files.length,
                });
            }
            catch (error) {
                logger.warn("[VeryfrontFSAdapter] Failed to fetch files during invalidation", { error });
            }
        }
        this.pokeMetrics.invalidationsTriggered++;
        logger.info("[VeryfrontFSAdapter] TRIGGERING FULL BROWSER RELOAD via ReloadNotifier", {
            projectSlug: this.projectSlug,
            projectId: this.client.getProjectId(),
            hasTriggerReloadCallback: !!this.invalidationCallbacks.triggerReload,
        });
        const environment = this.contentContext?.sourceType === "branch"
            ? "preview"
            : "production";
        const projectContext = {
            projectSlug: this.projectSlug,
            projectId: this.client.getProjectId(),
            environment,
            branch: this.contentContext?.branch ?? null,
            releaseId: this.contentContext?.releaseId ?? null,
        };
        this.invalidationCallbacks.triggerReload?.(undefined, projectContext);
        logger.debug("[VeryfrontFSAdapter] CACHE INVALIDATION COMPLETE", {
            fileCacheCleared: totalFileCount,
            statCacheCleared: totalStatCount,
            dirCacheCleared: totalDirCount,
            filesListCacheCleared: totalFilesListCount,
            durationMs: Date.now() - startTime,
            totalInvalidations: this.pokeMetrics.invalidationsTriggered,
        });
        this.sendPokeAck("full");
    }
    getPokeMetrics() {
        return { ...this.pokeMetrics, connectionId: this.wsConnectionId };
    }
    /** Send acknowledgment back to API after cache invalidation completes */
    sendPokeAck(type, changedPaths) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN)
            return;
        try {
            this.ws.send(JSON.stringify({
                type: "poke_ack",
                data: {
                    invalidationType: type,
                    changedPaths: changedPaths ?? [],
                    timestamp: Date.now(),
                    connectionId: this.wsConnectionId,
                    totalInvalidations: this.pokeMetrics.invalidationsTriggered,
                },
            }));
            logger.debug("[VeryfrontFSAdapter] Poke acknowledgment sent", {
                type,
                changedPathsCount: changedPaths?.length ?? 0,
            });
        }
        catch (error) {
            logger.warn("[VeryfrontFSAdapter] Failed to send poke acknowledgment", { error });
        }
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
        this.cleanupWebSocketTimers();
        if (this.invalidationTimer) {
            clearTimeout(this.invalidationTimer);
            this.invalidationTimer = null;
        }
        if (this.ws) {
            try {
                this.ws.close();
            }
            catch (error) {
                logger.warn("[VeryfrontFSAdapter] Error closing WebSocket", { error: error });
            }
            this.ws = null;
        }
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
        const contextChanged = JSON.stringify(oldContext) !== JSON.stringify(context);
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
