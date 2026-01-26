import { createError, toError } from "../../../errors/veryfront-error.js";
import { serverLogger as logger } from "../../../utils/index.js";
export class RedisRateLimitStore {
    client = null;
    url;
    keyPrefix;
    constructor(options = {}) {
        this.url = options.url;
        this.keyPrefix = options.keyPrefix ?? "veryfront:ratelimit:";
    }
    async ensureClient() {
        if (this.client)
            return this.client;
        let createClient;
        try {
            const redisClientModule = ["npm:@redis/client", "@1.5.8"].join("");
            const mod = await import(redisClientModule);
            createClient = mod.createClient;
        }
        catch {
            throw toError(createError({
                type: "config",
                message: "Redis rate limit store requires npm:@redis/client. Install dependencies or use MemoryRateLimitStore.",
            }));
        }
        const client = createClient({ url: this.url });
        client.on?.("error", (err) => {
            logger.error("[redis-ratelimit] client error", err);
        });
        await client.connect();
        this.client = client;
        return client;
    }
    storageKey(key) {
        return `${this.keyPrefix}${key}`;
    }
    async increment(key, windowMs) {
        const client = await this.ensureClient();
        const redisKey = this.storageKey(key);
        const count = await client.incr(redisKey);
        if (count === 1) {
            await client.pExpire(redisKey, windowMs);
        }
        const pttl = await client.pTTL(redisKey);
        if (pttl === -1) {
            await client.pExpire(redisKey, windowMs);
            return { count, resetAt: Date.now() + windowMs };
        }
        const ttl = pttl > 0 ? pttl : windowMs;
        return { count, resetAt: Date.now() + ttl };
    }
    async reset(key) {
        const client = await this.ensureClient();
        await client.del(this.storageKey(key));
    }
    async destroy() {
        if (!this.client)
            return;
        await this.client.disconnect();
        this.client = null;
    }
}
