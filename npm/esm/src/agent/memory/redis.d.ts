/**
 * Redis Memory Backend
 *
 * Distributed memory implementation using Redis for multi-process deployments.
 * Enables conversation persistence across server restarts and horizontal scaling.
 */
import { type Memory, type MemoryConfigBase, type MemoryStats, type MinimalMessage } from "./memory-interface.js";
/**
 * Redis client interface (compatible with ioredis and node-redis)
 */
export interface RedisClient {
    get(key: string): Promise<string | null>;
    set(key: string, value: string, options?: {
        EX?: number;
    }): Promise<unknown>;
    del(key: string): Promise<number>;
    expire(key: string, seconds: number): Promise<number>;
}
/**
 * Redis memory configuration
 */
export interface RedisMemoryConfig extends MemoryConfigBase {
    type: "redis";
    /** Redis client instance */
    client: RedisClient;
    /** Key prefix for namespacing */
    keyPrefix?: string;
    /** TTL in seconds (default: 24 hours) */
    ttl?: number;
}
/**
 * Redis Memory - Distributed conversation storage
 *
 * Stores messages in Redis for:
 * - Multi-process deployments (clustering, serverless)
 * - Conversation persistence across restarts
 * - Horizontal scaling
 */
export declare class RedisMemory<M extends MinimalMessage = MinimalMessage> implements Memory<M> {
    private client;
    private agentId;
    private keyPrefix;
    private ttl;
    private config;
    constructor(agentId: string, config: RedisMemoryConfig);
    private getKey;
    add(message: M): Promise<void>;
    getMessages(): Promise<M[]>;
    clear(): Promise<void>;
    getStats(): Promise<MemoryStats>;
    touch(): Promise<void>;
    private trimToTokenLimit;
}
/**
 * Create Redis memory instance
 */
export declare function createRedisMemory<M extends MinimalMessage = MinimalMessage>(agentId: string, config: RedisMemoryConfig): RedisMemory<M>;
//# sourceMappingURL=redis.d.ts.map