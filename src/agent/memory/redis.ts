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
 * Redis client interface (compatible with ioredis and node-redis).
 *
 * The optional list operation methods (rpush, lrange, ltrim) enable atomic
 * append semantics. When present they are preferred over get+set, which has a
 * read-modify-write race under concurrent callers. Provide a client that
 * implements all methods for safe use in horizontally-scaled deployments.
 */
export interface RedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: { EX?: number }): Promise<unknown>;
  del(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  /** Atomically append one or more values to a list. Returns the new list length. */
  rpush?(key: string, ...values: string[]): Promise<number>;
  /** Return elements of a list between start and stop (inclusive). */
  lrange?(key: string, start: number, stop: number): Promise<string[]>;
  /** Trim a list to contain only elements between start and stop. */
  ltrim?(key: string, start: number, stop: number): Promise<unknown>;
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
  /** User ID for per-user memory isolation */
  userId?: string;
  /** TTL in seconds (default: 24 hours) */
  ttl?: number;
}

const DEFAULT_TTL = 86_400; // 24 hours
const DEFAULT_KEY_PREFIX = "veryfront:agent:memory:";

/** Implement redis memory. */
export class RedisMemory<M extends MinimalMessage = MinimalMessage> implements Memory<M> {
  private client: RedisClient;
  private agentId: string;
  private userId: string;
  private keyPrefix: string;
  private ttl: number;
  private config: RedisMemoryConfig;

  constructor(agentId: string, config: RedisMemoryConfig) {
    this.client = config.client;
    this.agentId = agentId;
    this.userId = config.userId ?? "anonymous";
    this.keyPrefix = config.keyPrefix ?? DEFAULT_KEY_PREFIX;
    this.ttl = config.ttl ?? DEFAULT_TTL;
    this.config = config;
  }

  private getKey(): string {
    return `${this.keyPrefix}${this.agentId}:${this.userId}`;
  }

  private parseMessages(data: string | null): M[] {
    if (!data) return [];
    try {
      return JSON.parse(data);
    } catch (error) {
      // Corrupt stored JSON — throwing here prevents callers from silently
      // overwriting all prior history with a single-message array. Callers
      // should catch this, log the failure, and decide whether to clear the key.
      throw new Error(
        `RedisMemory: corrupt message data for key "${this.getKey()}": ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  add(message: M): Promise<void> {
    return withSpan(
      "agent.memory.redis.add",
      async () => {
        const key = this.getKey();
        const { maxMessages, maxTokens } = this.config;

        // When the client supports list operations, use RPUSH for atomic append
        // rather than a non-atomic get+JSON-parse+set that loses writes under
        // concurrent callers (multi-process / horizontally-scaled deployments).
        if (this.client.rpush && this.client.lrange && this.client.ltrim) {
          await this.client.rpush(key, JSON.stringify(message));
          if (this.ttl > 0) {
            await this.client.expire(key, this.ttl);
          }

          // Trim list length if maxMessages is set
          if (maxMessages) {
            await this.client.ltrim(key, -maxMessages, -1);
          }

          // For token-budget trimming we need to read and re-write — this is
          // still a race but is rare (trimming only fires when approaching
          // the token ceiling).
          if (maxTokens) {
            const raw = await this.client.lrange(key, 0, -1);
            let messages: M[] = [];
            for (const item of raw) {
              try {
                messages.push(JSON.parse(item) as M);
              } catch {
                // Skip individual corrupt entries; partial loss is better than
                // aborting the entire add.
              }
            }
            messages = this.trimToTokenLimit(messages);
            await this.client.del(key);
            if (messages.length > 0) {
              await this.client.rpush(key, ...messages.map((m) => JSON.stringify(m)));
              if (this.ttl > 0) {
                await this.client.expire(key, this.ttl);
              }
            }
          }
          return;
        }

        // Fallback: non-atomic get+set path. Safe for single-process deployments
        // but has a lost-update race when multiple processes write concurrently.
        // Upgrade the RedisClient with rpush/lrange/ltrim to eliminate the race.
        let messages = this.parseMessages(await this.client.get(key));
        messages.push(message);

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

    // Subtract the removed message's token cost instead of re-scanning the full
    // array on every iteration — O(n) instead of O(n²) for large histories.
    while (tokenCount > maxTokens && messages.length > 1) {
      const removed = messages.shift()!;
      tokenCount -= estimateTokens([removed]);
    }

    return messages;
  }
}

/** Create redis memory. */
export function createRedisMemory<M extends MinimalMessage = MinimalMessage>(
  agentId: string,
  config: RedisMemoryConfig,
): RedisMemory<M> {
  return new RedisMemory<M>(agentId, config);
}
