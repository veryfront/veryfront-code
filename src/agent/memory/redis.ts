/****
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
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";

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

export class RedisMemory<M extends MinimalMessage = MinimalMessage> implements Memory<M> {
  private client: RedisClient;
  private agentId: string;
  private keyPrefix: string;
  private ttl: number;
  private config: RedisMemoryConfig;

  constructor(agentId: string, config: RedisMemoryConfig) {
    this.client = config.client;
    this.agentId = agentId;
    this.keyPrefix = config.keyPrefix ?? DEFAULT_KEY_PREFIX;
    this.ttl = config.ttl ?? DEFAULT_TTL;
    this.config = config;
  }

  private getKey(): string {
    return `${this.keyPrefix}${this.agentId}`;
  }

  private parseMessages(data: string | null): M[] {
    if (!data) return [];
    try {
      return JSON.parse(data);
    } catch (_) {
      /* expected: corrupted JSON in Redis, return empty message list */
      return [];
    }
  }

  add(message: M): Promise<void> {
    return withSpan(
      "agent.memory.redis.add",
      async () => {
        const key = this.getKey();
        let messages = this.parseMessages(await this.client.get(key));

        messages.push(message);

        const { maxMessages, maxTokens } = this.config;

        if (maxMessages && messages.length > maxMessages) {
          messages = messages.slice(-maxMessages);
        }

        if (maxTokens) {
          messages = this.trimToTokenLimit(messages);
        }

        // TTL <= 0 means no expiration
        const options = this.ttl > 0 ? { EX: this.ttl } : undefined;
        await this.client.set(key, JSON.stringify(messages), options);
      },
      { "memory.type": "redis", "memory.agent_id": this.agentId, "memory.ttl": this.ttl },
    );
  }

  getMessages(): Promise<M[]> {
    return withSpan(
      "agent.memory.redis.getMessages",
      async () => this.parseMessages(await this.client.get(this.getKey())),
      { "memory.type": "redis", "memory.agent_id": this.agentId },
    );
  }

  clear(): Promise<void> {
    return withSpan(
      "agent.memory.redis.clear",
      async () => {
        await this.client.del(this.getKey());
      },
      { "memory.type": "redis", "memory.agent_id": this.agentId },
    );
  }

  getStats(): Promise<MemoryStats> {
    return withSpan(
      "agent.memory.redis.getStats",
      async () => {
        const messages = await this.getMessages();
        return {
          totalMessages: messages.length,
          estimatedTokens: estimateTokens(messages),
          type: "redis",
        };
      },
      { "memory.type": "redis", "memory.agent_id": this.agentId },
    );
  }

  touch(): Promise<void> {
    return withSpan(
      "agent.memory.redis.touch",
      async () => {
        // TTL <= 0 means no expiration, so touch is a no-op
        if (this.ttl <= 0) return;
        await this.client.expire(this.getKey(), this.ttl);
      },
      { "memory.type": "redis", "memory.agent_id": this.agentId, "memory.ttl": this.ttl },
    );
  }

  private trimToTokenLimit(messages: M[]): M[] {
    const { maxTokens } = this.config;
    if (!maxTokens) return messages;

    let tokenCount = estimateTokens(messages);

    while (tokenCount > maxTokens && messages.length > 1) {
      messages.shift();
      tokenCount = estimateTokens(messages);
    }

    return messages;
  }
}

export function createRedisMemory<M extends MinimalMessage = MinimalMessage>(
  agentId: string,
  config: RedisMemoryConfig,
): RedisMemory<M> {
  return new RedisMemory<M>(agentId, config);
}
