/**
 * Shared Redis Client Utility
 *
 * Provides a singleton Redis client with connection pooling,
 * automatic reconnection, and graceful fallback handling.
 */
export interface RedisClient {
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    get(key: string): Promise<string | null>;
    set(key: string, value: string, options?: {
        EX?: number;
    }): Promise<string | null>;
    del(key: string | string[]): Promise<number>;
    scan(cursor: number, options?: {
        MATCH?: string;
        COUNT?: number;
    }): Promise<{
        cursor: number;
        keys: string[];
    }>;
    expire(key: string, seconds: number): Promise<number>;
    on?(event: string, listener: (...args: unknown[]) => void): void;
    isOpen?: boolean;
}
export interface RedisClientOptions {
    url?: string;
    /** Connection timeout in milliseconds */
    connectTimeout?: number;
    /** Enable auto-reconnect on disconnect */
    autoReconnect?: boolean;
}
export declare function getRedisClient(options?: RedisClientOptions): Promise<RedisClient>;
export declare function isRedisAvailable(): boolean;
export declare function isRedisConfigured(): boolean;
export declare function disconnectRedis(): Promise<void>;
export declare function resetRedisState(): void;
//# sourceMappingURL=redis-client.d.ts.map