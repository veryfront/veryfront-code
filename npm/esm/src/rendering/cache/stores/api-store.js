import { MemoryCacheStore } from "./memory-store.js";
import { rendererLogger as logger } from "../../../utils/index.js";
import { createCacheBackend } from "../../../cache/backend.js";
export class APICacheStore {
    backend = null;
    backendInitPromise = null;
    localCache;
    keyPrefix;
    ttlSeconds;
    enableLocalCache;
    constructor(options = {}) {
        this.keyPrefix = options.keyPrefix ?? "render";
        this.ttlSeconds = options.ttlSeconds ?? 3600; // 1 hour default
        this.enableLocalCache = options.enableLocalCache ?? true;
        this.localCache = this.enableLocalCache
            ? new MemoryCacheStore({
                maxEntries: options.localMaxEntries ?? 200,
                ttlMs: this.ttlSeconds * 1000,
            })
            : null;
    }
    getBackend() {
        if (this.backend)
            return Promise.resolve(this.backend);
        if (this.backendInitPromise)
            return this.backendInitPromise;
        this.backendInitPromise = createCacheBackend({
            keyPrefix: this.keyPrefix,
            preferredBackend: "api",
        })
            .then((backend) => {
            this.backend = backend;
            logger.debug("[APICacheStore] Distributed cache initialized", {
                type: backend.type,
            });
            return backend;
        })
            .catch((error) => {
            logger.warn("[APICacheStore] Failed to init distributed cache, skipping fallback", { error });
            this.backend = null;
            throw error;
        });
        return this.backendInitPromise;
    }
    serialize(payload) {
        const serialized = {
            result: {
                html: payload.result.html,
                css: payload.result.css,
                frontmatter: payload.result.frontmatter,
                headings: payload.result.headings,
                nodeMapEntries: payload.result.nodeMap
                    ? Array.from(payload.result.nodeMap.entries())
                    : undefined,
                pageModule: payload.result.pageModule,
                ssrHash: payload.result.ssrHash,
            },
            storedAt: payload.storedAt,
            expiresAt: payload.expiresAt,
        };
        return JSON.stringify(serialized);
    }
    deserialize(json) {
        const serialized = JSON.parse(json);
        return {
            result: {
                html: serialized.result.html,
                css: serialized.result.css,
                frontmatter: serialized.result.frontmatter,
                headings: serialized.result.headings,
                nodeMap: serialized.result.nodeMapEntries
                    ? new Map(serialized.result.nodeMapEntries)
                    : undefined,
                stream: null, // Streams can't be serialized
                pageModule: serialized.result.pageModule,
                ssrHash: serialized.result.ssrHash,
            },
            storedAt: serialized.storedAt,
            expiresAt: serialized.expiresAt,
        };
    }
    async get(key) {
        if (this.localCache) {
            const local = await this.localCache.get(key);
            if (local)
                return local;
        }
        try {
            const backend = await this.getBackend();
            const json = await backend.get(key);
            if (!json)
                return undefined;
            const payload = this.deserialize(json);
            await this.localCache?.set(key, payload);
            logger.debug("[APICacheStore] Distributed cache hit", { key });
            return payload;
        }
        catch (error) {
            logger.debug("[APICacheStore] Failed to read from distributed cache", {
                key,
                error,
            });
            return undefined;
        }
    }
    async set(key, value) {
        if (value.result.stream)
            return;
        await this.localCache?.set(key, value);
        this.getBackend()
            .then((backend) => backend.set(key, this.serialize(value), this.ttlSeconds))
            .catch((error) => {
            logger.debug("[APICacheStore] Failed to store in distributed cache (no fallback)", {
                key,
                error,
            });
        });
    }
    async delete(key) {
        await this.localCache?.delete(key);
        try {
            const backend = await this.getBackend();
            await backend.del(key);
        }
        catch (error) {
            logger.debug("[APICacheStore] Failed to delete from distributed cache", {
                key,
                error,
            });
        }
    }
    async deleteByPrefix(prefix) {
        const localDeleted = (await this.localCache?.deleteByPrefix?.(prefix)) ?? 0;
        let distributedDeleted = 0;
        try {
            const backend = await this.getBackend();
            distributedDeleted = (await backend.delByPattern?.(`${prefix}*`)) ?? 0;
        }
        catch (error) {
            logger.debug("[APICacheStore] Failed to delete from distributed cache", {
                prefix,
                error,
            });
        }
        logger.debug("[APICacheStore] deleteByPrefix", {
            prefix,
            localDeleted,
            distributedDeleted,
        });
        return localDeleted + distributedDeleted;
    }
    async clear() {
        await this.localCache?.clear();
        logger.debug("[APICacheStore] Local cache cleared");
    }
    async destroy() {
        await this.localCache?.destroy();
        this.backend = null;
        this.backendInitPromise = null;
    }
}
