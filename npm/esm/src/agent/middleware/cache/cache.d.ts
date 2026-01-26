import type { AgentResponse } from "../../types.js";
export interface CacheConfig {
    strategy: "memory" | "lru" | "ttl";
    maxSize?: number;
    ttl?: number;
    keyGenerator?: (input: string, context?: Record<string, unknown>) => string;
}
export interface CacheEntry {
    response: AgentResponse;
    cachedAt: number;
    expiresAt?: number;
    accessCount: number;
    lastAccessedAt: number;
}
export declare function createCache(config: CacheConfig): {
    get(input: string, context?: Record<string, unknown>): AgentResponse | null;
    set(input: string, response: AgentResponse, context?: Record<string, unknown>): void;
    has(input: string, context?: Record<string, unknown>): boolean;
    delete(input: string, context?: Record<string, unknown>): void;
    clear(): void;
    size(): number;
};
export declare function cacheMiddleware(config: CacheConfig): (context: Record<string, unknown>, next: () => Promise<AgentResponse>) => Promise<AgentResponse>;
//# sourceMappingURL=cache.d.ts.map