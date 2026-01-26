import { rendererLogger as logger } from "../../../utils/index.js";
import { createError, toError } from "../../../errors/veryfront-error.js";
import { MemoryCacheStore } from "./memory-store.js";
/** Default TTL for Redis cache entries (1 hour) */
const DEFAULT_TTL_SECONDS = 3600;
export class RedisCacheStore {
    client = null;
    url;
    keyPrefix;
    enableFallback;
    ttlSeconds;
    fallbackStore = null;
    redisUnavailable = false;
    errorLogged = false;
    constructor(options = {}) {
        this.url = options.url;
        this.keyPrefix = options.keyPrefix ?? "veryfront:render:";
        this.enableFallback = options.enableFallback ?? false;
        this.ttlSeconds = options.ttlSeconds ?? DEFAULT_TTL_SECONDS;
    }
    getFallbackStore() {
        if (this.fallbackStore)
            return this.fallbackStore;
        // Small fallback cache (100 entries) for when Redis is unavailable
        this.fallbackStore = new MemoryCacheStore({ maxEntries: 100 });
        logger.warn("[redis] Redis unavailable, using memory cache fallback");
        return this.fallbackStore;
    }
    async ensureClient() {
        if (this.client)
            return this.client;
        let createClient;
        try {
            // Construct module name dynamically to prevent Deno static analyzer
            // from trying to resolve this npm package during lint/check
            const redisClientModule = ["npm:@redis/client", "@1.5.8"].join("");
            const mod = await import(redisClientModule);
            createClient = mod.createClient;
        }
        catch {
            throw toError(createError({
                type: "render",
                message: "Redis cache store requires npm:@redis/client. Install dependencies or switch cache.render.type to 'memory' or 'filesystem'.",
            }));
        }
        const client = createClient({ url: this.url });
        client.on?.("error", (err) => {
            // Only log the first error to avoid flooding logs during reconnection attempts
            if (!this.errorLogged) {
                logger.error("[redis] client error", err);
                this.errorLogged = true;
            }
            this.redisUnavailable = true;
        });
        await client.connect();
        this.client = client;
        this.redisUnavailable = false;
        this.errorLogged = false;
        return client;
    }
    storageKey(key) {
        return `${this.keyPrefix}${key}`;
    }
    async get(key) {
        if (this.redisUnavailable && this.enableFallback) {
            return this.getFallbackStore().get(key);
        }
        if (this.redisUnavailable && !this.enableFallback) {
            return undefined;
        }
        try {
            const client = await this.ensureClient();
            const raw = await client.get(this.storageKey(key));
            if (!raw)
                return undefined;
            try {
                return JSON.parse(raw);
            }
            catch {
                return undefined;
            }
        }
        catch (error) {
            if (!this.enableFallback) {
                logger.warn("[redis] get failed, skipping fallback", { key, error });
                this.redisUnavailable = true;
                return undefined;
            }
            logger.warn("[redis] get failed, using fallback", { key, error });
            this.redisUnavailable = true;
            return this.getFallbackStore().get(key);
        }
    }
    async set(key, value) {
        if (this.redisUnavailable && this.enableFallback) {
            return this.getFallbackStore().set(key, value);
        }
        if (this.redisUnavailable && !this.enableFallback)
            return;
        try {
            const client = await this.ensureClient();
            // Apply TTL to prevent unbounded Redis growth
            await client.set(this.storageKey(key), JSON.stringify(value), { EX: this.ttlSeconds });
        }
        catch (error) {
            if (!this.enableFallback) {
                logger.warn("[redis] set failed, skipping fallback", { key, error });
                this.redisUnavailable = true;
                return;
            }
            logger.warn("[redis] set failed, using fallback", { key, error });
            this.redisUnavailable = true;
            return this.getFallbackStore().set(key, value);
        }
    }
    async delete(key) {
        if (this.redisUnavailable && this.enableFallback) {
            return this.getFallbackStore().delete(key);
        }
        if (this.redisUnavailable && !this.enableFallback)
            return;
        try {
            const client = await this.ensureClient();
            await client.del(this.storageKey(key));
        }
        catch (error) {
            if (!this.enableFallback) {
                logger.warn("[redis] delete failed, skipping fallback", { key, error });
                this.redisUnavailable = true;
                return;
            }
            logger.warn("[redis] delete failed, using fallback", { key, error });
            this.redisUnavailable = true;
            return this.getFallbackStore().delete(key);
        }
    }
    async deleteByPrefix(prefix) {
        const localDeleted = (await this.fallbackStore?.deleteByPrefix?.(prefix)) ?? 0;
        if (this.redisUnavailable && this.enableFallback) {
            return localDeleted;
        }
        if (this.redisUnavailable && !this.enableFallback) {
            return localDeleted;
        }
        try {
            const client = await this.ensureClient();
            let cursor = 0;
            const keysToDelete = [];
            do {
                const [nextCursor, keys] = await client.scan(cursor, {
                    MATCH: `${this.keyPrefix}${prefix}*`,
                    COUNT: 100,
                });
                cursor = nextCursor;
                if (keys.length)
                    keysToDelete.push(...keys);
            } while (cursor !== 0);
            if (!keysToDelete.length)
                return localDeleted;
            const deleteResults = await Promise.all(keysToDelete.map((key) => client.del(key)));
            const deleted = deleteResults.reduce((sum, count) => sum + count, 0);
            return localDeleted + deleted;
        }
        catch (error) {
            if (!this.enableFallback) {
                logger.warn("[redis] deleteByPrefix failed, skipping fallback", { prefix, error });
                this.redisUnavailable = true;
                return localDeleted;
            }
            logger.warn("[redis] deleteByPrefix failed, using fallback", { prefix, error });
            this.redisUnavailable = true;
            return localDeleted;
        }
    }
    async clear() {
        await this.fallbackStore?.clear();
        if (this.redisUnavailable && this.enableFallback)
            return;
        if (this.redisUnavailable && !this.enableFallback)
            return;
        try {
            const client = await this.ensureClient();
            let cursor = 0;
            do {
                const [nextCursor, keys] = await client.scan(cursor, {
                    MATCH: `${this.keyPrefix}*`,
                    COUNT: 50,
                });
                cursor = nextCursor;
                for (const key of keys) {
                    await client.del(key);
                }
            } while (cursor !== 0);
        }
        catch (error) {
            if (!this.enableFallback) {
                logger.warn("[redis] clear failed, skipping fallback", { error });
                this.redisUnavailable = true;
                return;
            }
            logger.warn("[redis] clear failed", { error });
            this.redisUnavailable = true;
        }
    }
    async destroy() {
        if (this.fallbackStore) {
            await this.fallbackStore.destroy();
            this.fallbackStore = null;
        }
        if (!this.client)
            return;
        await this.client.disconnect();
        this.client = null;
    }
}
