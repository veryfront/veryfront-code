import * as dntShim from "../../../../../_dnt.shims.js";
import { AsyncLocalStorage } from "node:async_hooks";
import { logger } from "../../../../utils/index.js";
import { ProxyFSAdapterManager } from "./proxy-manager.js";
import { runWithCacheBatching } from "../../../../cache/request-cache-batcher.js";
const asyncLocalStorage = new AsyncLocalStorage();
export class MultiProjectFSAdapter {
    manager;
    defaultAdapter;
    constructor(config) {
        this.manager = new ProxyFSAdapterManager({
            baseConfig: config,
            maxAdapters: 100,
            cleanupIntervalMs: 5 * 60 * 1000,
            maxIdleMs: 30 * 60 * 1000,
        });
        logger.debug("[MultiProjectFSAdapter] Created", {
            proxyMode: config.veryfront?.proxyMode,
        });
    }
    runWithContext(projectSlug, token, fn, projectId, options) {
        const startTime = performance.now();
        const productionMode = options?.productionMode ?? false;
        const releaseId = options?.releaseId ?? null;
        const branch = options?.branch ?? null;
        const environmentName = options?.environmentName ?? null;
        logger.debug("[MultiProjectFSAdapter] runWithContext START", {
            projectSlug,
            hasToken: !!token,
            productionMode,
            releaseId: productionMode ? releaseId : undefined,
            branch: productionMode ? undefined : branch,
            environmentName,
        });
        const context = {
            projectSlug,
            projectId,
            token,
            productionMode,
            releaseId: productionMode ? releaseId : null,
            branch: productionMode ? null : branch,
            environmentName,
            fileCache: new Map(),
        };
        logger.debug("[MultiProjectFSAdapter] asyncLocalStorage.run START", { projectSlug });
        return asyncLocalStorage.run(context, async () => {
            logger.debug("[MultiProjectFSAdapter] Inside asyncLocalStorage.run callback", {
                projectSlug,
                duration: `${(performance.now() - startTime).toFixed(2)}ms`,
            });
            const result = await runWithCacheBatching(fn);
            logger.debug("[MultiProjectFSAdapter] runWithContext callback complete", {
                projectSlug,
                totalDuration: `${(performance.now() - startTime).toFixed(2)}ms`,
            });
            return result;
        });
    }
    setRequestContext(projectSlug, token) {
        const store = asyncLocalStorage.getStore();
        if (!store)
            return;
        store.projectSlug = projectSlug;
        store.token = token;
    }
    setProductionMode(_enabled, _releaseId) {
        // No-op: In proxy mode, productionMode/releaseId are passed via runWithContext().
    }
    async getAdapter() {
        const startTime = performance.now();
        const context = asyncLocalStorage.getStore();
        if (!context) {
            logger.debug("[MultiProjectFSAdapter] No context available", {
                hasDefaultAdapter: !!this.defaultAdapter,
            });
            if (this.defaultAdapter)
                return this.defaultAdapter;
            throw new Error("[MultiProjectFSAdapter] No request context available. " +
                "Use runWithContext() to set project context before accessing files.");
        }
        const productionMode = context.productionMode ?? false;
        const releaseId = context.releaseId ?? null;
        const environmentName = context.environmentName ?? null;
        logger.debug("[MultiProjectFSAdapter] getAdapter RELEASE_ID_CHECK", {
            projectSlug: context.projectSlug,
            productionMode,
            releaseId,
            environmentName,
            branch: context.branch,
            hasReleaseId: !!releaseId,
        });
        const adapter = await this.manager.getAdapter(context.projectSlug, context.token, context.projectId, productionMode, releaseId, environmentName, context.branch);
        logger.debug("[MultiProjectFSAdapter] getAdapter DONE", {
            projectSlug: context.projectSlug,
            duration: `${(performance.now() - startTime).toFixed(2)}ms`,
        });
        return adapter;
    }
    setDefaultAdapter(adapter) {
        this.defaultAdapter = adapter;
    }
    initialize() {
        logger.debug("[MultiProjectFSAdapter] Initialized (lazy per-project initialization)");
        return Promise.resolve();
    }
    async readFile(path) {
        return (await this.getAdapter()).readFile(path);
    }
    async readTextFile(path) {
        return (await this.getAdapter()).readTextFile(path);
    }
    async exists(path) {
        return (await this.getAdapter()).exists(path);
    }
    async stat(path) {
        return (await this.getAdapter()).stat(path);
    }
    async readdir(path) {
        return (await this.getAdapter()).readdir(path);
    }
    async resolveFile(basePath) {
        return (await this.getAdapter()).resolveFile(basePath);
    }
    dispose() {
        this.manager.dispose();
        this.defaultAdapter?.dispose();
        this.defaultAdapter = undefined;
        logger.debug("[MultiProjectFSAdapter] Disposed");
    }
    getManagerStats() {
        return this.manager.getStats();
    }
    async getProjectData() {
        try {
            const adapter = await this.getAdapter();
            return adapter.getProjectData?.();
        }
        catch {
            return undefined;
        }
    }
    async getFilePathByEntityId(entityId) {
        try {
            const adapter = await this.getAdapter();
            return adapter.getFilePathByEntityId?.(entityId);
        }
        catch {
            return undefined;
        }
    }
    async getAllSourceFiles() {
        try {
            const adapter = await this.getAdapter();
            const files = (await adapter.getAllSourceFiles?.()) ?? [];
            if (files.length === 0) {
                logger.debug("[MultiProjectFSAdapter] getAllSourceFiles returned empty", {
                    hasAdapter: !!adapter,
                    hasMethod: typeof adapter.getAllSourceFiles === "function",
                });
            }
            return files;
        }
        catch (error) {
            logger.warn("[MultiProjectFSAdapter] getAllSourceFiles failed", {
                error: error instanceof Error ? error.message : String(error),
            });
            return [];
        }
    }
}
export function isMultiProjectAdapter(adapter) {
    return adapter instanceof MultiProjectFSAdapter;
}
export function getCurrentRequestContext() {
    return asyncLocalStorage.getStore() ?? null;
}
export function getRequestScopedFile(cacheKey) {
    return asyncLocalStorage.getStore()?.fileCache?.get(cacheKey);
}
export function setRequestScopedFile(cacheKey, content) {
    asyncLocalStorage.getStore()?.fileCache?.set(cacheKey, content);
}
// Register globally for lazy access from cache-key-builder to avoid circular dependency
// deno-lint-ignore no-explicit-any
dntShim.dntGlobalThis.__vf_multi_project_adapter = {
    getCurrentRequestContext,
    getRequestScopedFile,
    setRequestScopedFile,
};
