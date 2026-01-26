/**
 * Redis Memory Backend
 *
 * Distributed memory implementation using Redis for multi-process deployments.
 * Enables conversation persistence across server restarts and horizontal scaling.
 */
import { estimateTokens, } from "./memory-interface.js";
import { withSpan } from "../../observability/tracing/otlp-setup.js";
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
export class RedisMemory {
    client;
    agentId;
    keyPrefix;
    ttl;
    config;
    constructor(agentId, config) {
        this.client = config.client;
        this.agentId = agentId;
        this.keyPrefix = config.keyPrefix ?? DEFAULT_KEY_PREFIX;
        this.ttl = config.ttl ?? DEFAULT_TTL;
        this.config = config;
    }
    getKey() {
        return `${this.keyPrefix}${this.agentId}`;
    }
    add(message) {
        return withSpan("agent.memory.redis.add", async () => {
            const key = this.getKey();
            const existingData = await this.client.get(key);
            let messages = [];
            if (existingData) {
                try {
                    messages = JSON.parse(existingData);
                }
                catch {
                    messages = [];
                }
            }
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
        }, { "memory.type": "redis", "memory.agent_id": this.agentId, "memory.ttl": this.ttl });
    }
    getMessages() {
        return withSpan("agent.memory.redis.getMessages", async () => {
            const data = await this.client.get(this.getKey());
            if (!data)
                return [];
            try {
                return JSON.parse(data);
            }
            catch {
                return [];
            }
        }, { "memory.type": "redis", "memory.agent_id": this.agentId });
    }
    clear() {
        return withSpan("agent.memory.redis.clear", async () => {
            await this.client.del(this.getKey());
        }, { "memory.type": "redis", "memory.agent_id": this.agentId });
    }
    getStats() {
        return withSpan("agent.memory.redis.getStats", async () => {
            const messages = await this.getMessages();
            return {
                totalMessages: messages.length,
                estimatedTokens: estimateTokens(messages),
                type: "redis",
            };
        }, { "memory.type": "redis", "memory.agent_id": this.agentId });
    }
    touch() {
        return withSpan("agent.memory.redis.touch", async () => {
            // TTL <= 0 means no expiration, so touch is a no-op
            if (this.ttl > 0) {
                await this.client.expire(this.getKey(), this.ttl);
            }
        }, { "memory.type": "redis", "memory.agent_id": this.agentId, "memory.ttl": this.ttl });
    }
    trimToTokenLimit(messages) {
        const maxTokens = this.config.maxTokens;
        if (!maxTokens)
            return messages;
        let tokenCount = estimateTokens(messages);
        while (tokenCount > maxTokens && messages.length > 1) {
            messages.shift();
            tokenCount = estimateTokens(messages);
        }
        return messages;
    }
}
/**
 * Create Redis memory instance
 */
export function createRedisMemory(agentId, config) {
    return new RedisMemory(agentId, config);
}
