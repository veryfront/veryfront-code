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
import { INVALID_ARGUMENT } from "#veryfront/errors";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { agentLogger } from "#veryfront/utils";

/**
 * Redis client interface (compatible with ioredis and node-redis)
 */
export interface RedisEvalOptions {
  /** Redis keys referenced by the script. */
  keys: string[];
  /** Positional script arguments. */
  arguments: string[];
}

/** Minimal Redis client surface required by {@link RedisMemory}. */
export interface RedisClient {
  /** Read a serialized conversation by key. */
  get(key: string): Promise<string | null>;
  /** Delete a conversation key. */
  del(key: string): Promise<number>;
  /** Set the remaining lifetime of a conversation key. */
  expire(key: string, seconds: number): Promise<number>;
}

type AtomicRedisClient = {
  sendCommand?: (args: string[]) => Promise<unknown>;
  call?: (command: string, ...args: string[]) => Promise<unknown>;
  eval?: (script: string, options: RedisEvalOptions) => Promise<unknown>;
};

/** Configuration for one Redis-backed conversation memory store. */
export interface RedisMemoryConfig extends Omit<MemoryConfigBase, "type" | "enabled"> {
  /** Selects Redis memory. */
  type: "redis";
  /** Redis stores are active when constructed. */
  enabled?: true;
  /** Connected Redis client instance. */
  client: RedisClient;
  /** Key prefix used to namespace agent memory. */
  keyPrefix?: string;
  /** Stable conversation or user identifier used in the Redis key. */
  userId?: string;
  /** Key lifetime in seconds. Defaults to 24 hours. Use zero for no expiry. */
  ttl?: number;
}

const DEFAULT_TTL = 86_400; // 24 hours
const DEFAULT_KEY_PREFIX = "veryfront:agent:memory:";

function invalidRedisMemoryConfig(detail: string): never {
  throw INVALID_ARGUMENT.create({ detail: `Redis memory ${detail}` });
}

function validateNonEmptyString(value: unknown, name: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    invalidRedisMemoryConfig(`${name} must be a non-empty string`);
  }
}

function validatePositiveSafeInteger(value: unknown, name: string): void {
  if (value === undefined) return;
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    invalidRedisMemoryConfig(`${name} must be a positive safe integer`);
  }
}

function validateRedisMemoryConfig(
  agentId: unknown,
  config: unknown,
): asserts config is RedisMemoryConfig {
  validateNonEmptyString(agentId, "agentId");
  if (typeof config !== "object" || config === null) {
    invalidRedisMemoryConfig("config must be an object");
  }

  const candidate = config as Record<string, unknown>;
  if (candidate.type !== "redis") {
    invalidRedisMemoryConfig('config.type must be "redis"');
  }
  validatePositiveSafeInteger(candidate.maxMessages, "maxMessages");
  validatePositiveSafeInteger(candidate.maxTokens, "maxTokens");

  if (candidate.ttl !== undefined) {
    if (!Number.isSafeInteger(candidate.ttl) || (candidate.ttl as number) < 0) {
      invalidRedisMemoryConfig("ttl must be a non-negative safe integer");
    }
  }
  if (candidate.keyPrefix !== undefined) {
    validateNonEmptyString(candidate.keyPrefix, "keyPrefix");
  }
  if (candidate.userId !== undefined) {
    validateNonEmptyString(candidate.userId, "userId");
  }
  if (candidate.enabled !== undefined && candidate.enabled !== true) {
    invalidRedisMemoryConfig("enabled must be true when provided");
  }

  if (typeof candidate.client !== "object" || candidate.client === null) {
    invalidRedisMemoryConfig("client must be an object");
  }
  const client = candidate.client as Record<string, unknown>;
  for (const method of ["get", "del", "expire"] as const) {
    if (typeof client[method] !== "function") {
      invalidRedisMemoryConfig(`client.${method} must be a function`);
    }
  }
  if (
    typeof client.sendCommand !== "function" &&
    typeof client.call !== "function" &&
    typeof client.eval !== "function"
  ) {
    invalidRedisMemoryConfig(
      "client must expose an atomic Redis command through sendCommand(), call(), or eval()",
    );
  }
}

function isStoredMessage(value: unknown): value is MinimalMessage {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.id !== "string" || candidate.id.length === 0) return false;
  if (
    candidate.role !== "user" && candidate.role !== "assistant" &&
    candidate.role !== "system" && candidate.role !== "tool"
  ) {
    return false;
  }
  if (!Array.isArray(candidate.parts)) return false;
  return candidate.parts.every((part) => {
    if (typeof part !== "object" || part === null) return false;
    return typeof (part as Record<string, unknown>).type === "string";
  });
}

const ATOMIC_ADD_SCRIPT = `
local key = KEYS[1]
local message_json = ARGV[1]
local max_messages = tonumber(ARGV[2]) or 0
local max_tokens = tonumber(ARGV[3]) or 0
local ttl = tonumber(ARGV[4]) or 0

local function decode_json(value, label, expected_prefix)
  local prefix = string.match(value, "^%s*(.)")
  if prefix ~= expected_prefix then
    return nil, redis.error_reply("CORRUPT_REDIS_MEMORY_JSON:" .. label)
  end
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
  local decoded, decode_error = decode_json(current, "stored", "[")
  if decode_error then return decode_error end
  messages = decoded
end

local message, message_error = decode_json(message_json, "message", "{")
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

/** Redis-backed memory with atomic append and bounded retention. */
export class RedisMemory<M extends MinimalMessage = MinimalMessage> implements Memory<M> {
  private client: RedisClient;
  private agentId: string;
  private userId: string;
  private keyPrefix: string;
  private ttl: number;
  private config: RedisMemoryConfig;

  /** Create a validated Redis-backed memory instance. */
  constructor(agentId: string, config: RedisMemoryConfig) {
    validateRedisMemoryConfig(agentId, config);
    this.client = config.client;
    this.agentId = agentId;
    this.userId = config.userId ?? "anonymous";
    this.keyPrefix = config.keyPrefix ?? DEFAULT_KEY_PREFIX;
    this.ttl = config.ttl ?? DEFAULT_TTL;
    this.config = { ...config };
  }

  /** Returns key. */
  private getKey(): string {
    return `${this.keyPrefix}${this.agentId}:${this.userId}`;
  }

  /** Parses messages. */
  private parseMessages(data: string | null): M[] {
    if (data === null) return [];
    try {
      const parsed: unknown = JSON.parse(data);
      if (!Array.isArray(parsed) || !parsed.every(isStoredMessage)) {
        throw new SyntaxError("Redis memory contains invalid message data");
      }
      return parsed as M[];
    } catch (error) {
      // Do NOT swallow-and-return []: add() would then overwrite the key with a
      // single message and permanently destroy the stored history. Surface the
      // corruption so the caller aborts instead of silently truncating.
      agentLogger.error("Redis memory contains invalid stored data; refusing to overwrite", {
        errorName: error instanceof Error ? error.name : typeof error,
        keyLength: this.getKey().length,
      });
      throw error;
    }
  }

  /** Adds a message to memory. */
  add(message: M): Promise<void> {
    return withSpan(
      "agent.memory.redis.add",
      async () => {
        if (!isStoredMessage(message)) {
          throw INVALID_ARGUMENT.create({
            detail: "Redis memory message must include a valid id, role, and parts array",
          });
        }
        const key = this.getKey();
        await this.atomicAdd(key, message);
      },
      { "memory.type": "redis", "memory.agent_id": this.agentId, "memory.ttl": this.ttl },
    );
  }

  /** Return the stored conversation messages. */
  getMessages(): Promise<M[]> {
    return withSpan(
      "agent.memory.redis.getMessages",
      async () => this.parseMessages(await this.client.get(this.getKey())),
      { "memory.type": "redis", "memory.agent_id": this.agentId },
    );
  }

  /** Clears stored conversation state. */
  clear(): Promise<void> {
    return withSpan(
      "agent.memory.redis.clear",
      async () => {
        await this.client.del(this.getKey());
      },
      { "memory.type": "redis", "memory.agent_id": this.agentId },
    );
  }

  /** Return message and estimated-token counts for the stored conversation. */
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

  /** Refresh the configured key expiry without changing conversation data. */
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

  /** Append one message with an atomic Redis script. */
  private async atomicAdd(key: string, message: M): Promise<void> {
    const args = [
      JSON.stringify(message),
      String(this.config.maxMessages ?? 0),
      String(this.config.maxTokens ?? 0),
      String(this.ttl),
    ];
    const atomicClient = this.client as RedisClient & AtomicRedisClient;

    if (typeof atomicClient.sendCommand === "function") {
      await atomicClient.sendCommand(["EVAL", ATOMIC_ADD_SCRIPT, "1", key, ...args]);
      return;
    }

    if (typeof atomicClient.call === "function") {
      await atomicClient.call("EVAL", ATOMIC_ADD_SCRIPT, "1", key, ...args);
      return;
    }

    if (typeof atomicClient.eval === "function") {
      await atomicClient.eval(ATOMIC_ADD_SCRIPT, { keys: [key], arguments: args });
      return;
    }

    throw new Error(
      "RedisMemory requires Redis sendCommand(), call(), or eval() for atomic add(); " +
        "non-atomic GET/SET append is not supported",
    );
  }
}

/** Create a validated Redis-backed memory instance for an agent and user. */
export function createRedisMemory<M extends MinimalMessage = MinimalMessage>(
  agentId: string,
  config: RedisMemoryConfig,
): RedisMemory<M> {
  return new RedisMemory<M>(agentId, config);
}
