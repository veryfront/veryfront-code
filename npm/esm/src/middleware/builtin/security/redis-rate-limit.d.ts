import type { RateLimitEntry, RateLimitStore } from "./types.js";
export interface RedisRateLimitOptions {
    url?: string;
    keyPrefix?: string;
}
export declare class RedisRateLimitStore implements RateLimitStore {
    private client;
    private clientPromise;
    private readonly url?;
    private readonly keyPrefix;
    constructor(options?: RedisRateLimitOptions);
    private ensureClient;
    private connectClient;
    private storageKey;
    increment(key: string, windowMs: number): Promise<RateLimitEntry>;
    reset(key: string): Promise<void>;
    destroy(): Promise<void>;
}
//# sourceMappingURL=redis-rate-limit.d.ts.map