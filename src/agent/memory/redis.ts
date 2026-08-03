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
import { agentLogger } from "#veryfront/utils";

/**
 * Redis client interface (compatible with ioredis and node-redis)
 */
export interface RedisEvalOptions {
  keys: string[];
  arguments: string[];
}

export interface RedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: { EX?: number }): Promise<unknown>;
  del(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  eval?(script: string, options: RedisEvalOptions): Promise<unknown>;
  sendCommand?(args: string[]): Promise<unknown>;
  call?(command: string, ...args: string[]): Promise<unknown>;
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

const ATOMIC_ADD_SCRIPT = `
local key = KEYS[1]
local message_json = ARGV[1]
local max_messages = tonumber(ARGV[2]) or 0
local max_tokens = tonumber(ARGV[3]) or 0
local ttl = tonumber(ARGV[4]) or 0

local function decode_json(value, label)
  local ok, decoded = pcall(cjson.decode, value)
  if not ok then
    return nil, redis.error_reply("CORRUPT_REDIS_MEMORY_JSON:" .. label)
  end
  if type(decoded) ~= "table" then
    return nil, redis.error_reply("CORRUPT_REDIS_MEMORY_JSON:" .. label)
  end
  return decoded, nil
end

local messages = {}
local current = redis.call("GET", key)
if current and current ~= "" then
  local decoded, decode_error = decode_json(current, "stored")
  if decode_error then return decode_error end
  messages = decoded
end

local message, message_error = decode_json(message_json, "message")
if message_error then return message_error end
table.insert(messages, message)

if max_messages > 0 then
  while #messages > max_messages do
    table.remove(messages, 1)
  end
end

local function message_text_length(item)
  if type(item) ~= "table" or type(item.parts) ~= "table" then return 0 end
  local total = 0
  for _, part in ipairs(item.parts) do
    if type(part) == "table" and part.type == "text" and type(part.text) == "string" then
      total = total + string.len(part.text)
    end
  end
  return total
end

local function estimate_tokens(items)
  local total = 0
  for _, item in ipairs(items) do
    total = total + message_text_length(item)
  end
  return math.ceil(total / 4)
end

if max_tokens > 0 then
  while #messages > 1 and estimate_tokens(messages) > max_tokens do
    table.remove(messages, 1)
  end
end

local encoded = cjson.encode(messages)
if ttl > 0 then
  redis.call("SET", key, encoded, "EX", ttl)
else
  redis.call("SET", key, encoded)
end

return #messages
`;

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
      // Do NOT swallow-and-return []: add() would then overwrite the key with a
      // single message and permanently destroy the stored history. Surface the
      // corruption so the caller aborts instead of silently truncating.
      agentLogger.error("Corrupted JSON in Redis memory; refusing to overwrite", {
        errorName: error instanceof Error ? error.name : typeof error,
        keyLength: this.getKey().length,
      });
      throw error;
    }
  }

  add(message: M): Promise<void> {
    return withSpan(
      "agent.memory.redis.add",
      async () => {
        const key = this.getKey();
        await this.atomicAdd(key, message);
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

  private atomicAdd(key: string, message: M): Promise<void> {
    const args = [
      JSON.stringify(message),
      String(this.config.maxMessages ?? 0),
      String(this.config.maxTokens ?? 0),
      String(this.ttl),
    ];

    if (typeof this.client.sendCommand === "function") {
      return this.client.sendCommand(["EVAL", ATOMIC_ADD_SCRIPT, "1", key, ...args]).then(
        () => {},
      );
    }

    if (typeof this.client.call === "function") {
      return this.client.call("EVAL", ATOMIC_ADD_SCRIPT, "1", key, ...args).then(() => {});
    }

    if (typeof this.client.eval === "function") {
      return this.client.eval(ATOMIC_ADD_SCRIPT, { keys: [key], arguments: args }).then(() => {});
    }

    throw new Error(
      "RedisMemory requires Redis sendCommand(), call(), or eval() for atomic add(); " +
        "non-atomic GET/SET append is not supported",
    );
  }
}

/** Create redis memory. */
export function createRedisMemory<M extends MinimalMessage = MinimalMessage>(
  agentId: string,
  config: RedisMemoryConfig,
): RedisMemory<M> {
  return new RedisMemory<M>(agentId, config);
}
