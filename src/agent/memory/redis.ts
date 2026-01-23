/**
 * Redis Memory Backend
 *
 * Distributed memory implementation using Redis for multi-process deployments.
 * Enables conversation persistence across server restarts and horizontal scaling.
 */

import {
  estimateTokens,
  type Memory,
  type MemoryConfigBase,
  type MemoryStats,
  type MinimalMessage,
} from "./memory-interface.ts";

/**
 * Redis client interface (compatible with ioredis and node-redis)
 */
export interface RedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: { EX?: number }): Promise<unknown>;
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

const DEFAULT_TTL = 86400; // 24 hours
const DEFAULT_KEY_PREFIX = "veryfront:agent:memory:";

/**
 * Redis Memory - Distributed conversation storage
 *
 * Stores messages in Redis for:
 * - Multi-process deployments (clustering, serverless)
 * - Conversation persistence across restarts
 * - Horizontal scaling
 */
export class RedisMemory<M extends MinimalMessage = MinimalMessage> implements Memory<M> {
  private client: RedisClient;
  private agentId: string;
  private keyPrefix: string;
  private ttl: number;
  private config: RedisMemoryConfig;

  constructor(agentId: string, config: RedisMemoryConfig) {
    this.client = config.client;
    this.agentId = agentId;
    this.keyPrefix = config.keyPrefix || DEFAULT_KEY_PREFIX;
    this.ttl = config.ttl || DEFAULT_TTL;
    this.config = config;
  }

  /**
   * Get the Redis key for this agent's messages
   */
  private getKey(): string {
    return `${this.keyPrefix}${this.agentId}`;
  }

  /**
   * Add a message to memory
   */
  async add(message: M): Promise<void> {
    const key = this.getKey();
    const existingData = await this.client.get(key);

    let messages: M[] = [];
    if (existingData) {
      try {
        messages = JSON.parse(existingData);
      } catch {
        messages = [];
      }
    }

    messages.push(message);

    // Apply limits
    if (this.config.maxMessages && messages.length > this.config.maxMessages) {
      messages = messages.slice(-this.config.maxMessages);
    }

    if (this.config.maxTokens) {
      messages = this.trimToTokenLimit(messages);
    }

    await this.client.set(key, JSON.stringify(messages), { EX: this.ttl });
  }

  /**
   * Get all messages
   */
  async getMessages(): Promise<M[]> {
    const key = this.getKey();
    const data = await this.client.get(key);

    if (!data) {
      return [];
    }

    try {
      return JSON.parse(data);
    } catch {
      return [];
    }
  }

  /**
   * Clear all messages
   */
  async clear(): Promise<void> {
    const key = this.getKey();
    await this.client.del(key);
  }

  /**
   * Get memory statistics
   */
  async getStats(): Promise<MemoryStats> {
    const messages = await this.getMessages();
    return {
      totalMessages: messages.length,
      estimatedTokens: estimateTokens(messages),
      type: "redis",
    };
  }

  /**
   * Refresh TTL (extend expiration)
   */
  async touch(): Promise<void> {
    const key = this.getKey();
    await this.client.expire(key, this.ttl);
  }

  /**
   * Trim messages to token limit
   */
  private trimToTokenLimit(messages: M[]): M[] {
    if (!this.config.maxTokens) return messages;

    let tokenCount = estimateTokens(messages);

    while (tokenCount > this.config.maxTokens && messages.length > 1) {
      messages.shift();
      tokenCount = estimateTokens(messages);
    }

    return messages;
  }
}

/**
 * Create Redis memory instance
 */
export function createRedisMemory<M extends MinimalMessage = MinimalMessage>(
  agentId: string,
  config: RedisMemoryConfig,
): RedisMemory<M> {
  return new RedisMemory<M>(agentId, config);
}
