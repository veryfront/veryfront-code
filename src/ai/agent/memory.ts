/**
 * Agent Memory System
 *
 * Manages conversation history with different strategies:
 * - Conversation: Keep all messages
 * - Buffer: Keep last N messages
 * - Summary: Summarize old messages to save tokens
 */

import { getTextFromParts, type MemoryConfig, type Message } from "../types/agent.ts";

/**
 * Memory interface
 */
export interface Memory {
  /**
   * Add a message to memory
   */
  add(message: Message): Promise<void>;

  /**
   * Get messages for the current context
   */
  getMessages(): Promise<Message[]>;

  /**
   * Clear all messages
   */
  clear(): Promise<void>;

  /**
   * Get memory stats
   */
  getStats(): Promise<MemoryStats>;
}

/**
 * Memory statistics
 */
export interface MemoryStats {
  /** Total messages stored */
  totalMessages: number;

  /** Estimated token count */
  estimatedTokens: number;

  /** Memory type */
  type: string;
}

/**
 * Conversation Memory - Keeps all messages
 */
export class ConversationMemory implements Memory {
  private messages: Message[] = [];
  private config: MemoryConfig;

  constructor(config: MemoryConfig) {
    this.config = config;
  }

  async add(message: Message): Promise<void> {
    this.messages.push(message);

    // Trim if max messages exceeded
    if (
      this.config.maxMessages &&
      this.messages.length > this.config.maxMessages
    ) {
      this.messages = this.messages.slice(-this.config.maxMessages);
    }

    // Trim if max tokens exceeded
    if (this.config.maxTokens) {
      await this.trimToTokenLimit();
    }
  }

  getMessages(): Promise<Message[]> {
    return Promise.resolve([...this.messages]);
  }

  clear(): Promise<void> {
    this.messages = [];
    return Promise.resolve();
  }

  getStats(): Promise<MemoryStats> {
    return Promise.resolve({
      totalMessages: this.messages.length,
      estimatedTokens: this.estimateTokens(this.messages),
      type: "conversation",
    });
  }

  private trimToTokenLimit(): Promise<void> {
    if (!this.config.maxTokens) return Promise.resolve();

    let tokenCount = this.estimateTokens(this.messages);

    // Remove oldest messages until under limit
    while (
      tokenCount > this.config.maxTokens &&
      this.messages.length > 1
    ) {
      this.messages.shift();
      tokenCount = this.estimateTokens(this.messages);
    }
    return Promise.resolve();
  }

  private estimateTokens(messages: Message[]): number {
    // Rough estimation: ~4 characters per token
    const totalChars = messages.reduce(
      (sum, msg) => sum + getTextFromParts(msg.parts).length,
      0,
    );
    return Math.ceil(totalChars / 4);
  }
}

/**
 * Buffer Memory - Keeps last N messages
 */
export class BufferMemory implements Memory {
  private messages: Message[] = [];
  private config: MemoryConfig;
  private bufferSize: number;

  constructor(config: MemoryConfig) {
    this.config = config;
    this.bufferSize = config.maxMessages || 10;
  }

  add(message: Message): Promise<void> {
    this.messages.push(message);

    // Keep only last N messages
    if (this.messages.length > this.bufferSize) {
      this.messages = this.messages.slice(-this.bufferSize);
    }
    return Promise.resolve();
  }

  getMessages(): Promise<Message[]> {
    return Promise.resolve([...this.messages]);
  }

  clear(): Promise<void> {
    this.messages = [];
    return Promise.resolve();
  }

  getStats(): Promise<MemoryStats> {
    return Promise.resolve({
      totalMessages: this.messages.length,
      estimatedTokens: this.estimateTokens(this.messages),
      type: "buffer",
    });
  }

  private estimateTokens(messages: Message[]): number {
    const totalChars = messages.reduce(
      (sum, msg) => sum + getTextFromParts(msg.parts).length,
      0,
    );
    return Math.ceil(totalChars / 4);
  }
}

/**
 * Summary Memory - Summarizes old messages
 * (Simplified version - full implementation would use LLM for summarization)
 */
export class SummaryMemory implements Memory {
  private messages: Message[] = [];
  private summary: string = "";
  private config: MemoryConfig;
  private summaryThreshold: number;

  constructor(config: MemoryConfig) {
    this.config = config;
    this.summaryThreshold = config.maxMessages || 20;
  }

  async add(message: Message): Promise<void> {
    this.messages.push(message);

    // Summarize if threshold exceeded
    if (this.messages.length > this.summaryThreshold) {
      await this.summarizeOldMessages();
    }
  }

  getMessages(): Promise<Message[]> {
    // If we have a summary, include it as first message
    if (this.summary) {
      return Promise.resolve([
        {
          id: "summary",
          role: "system",
          parts: [{ type: "text", text: `Previous conversation summary:\n${this.summary}` }],
          timestamp: Date.now(),
        },
        ...this.messages,
      ]);
    }

    return Promise.resolve([...this.messages]);
  }

  clear(): Promise<void> {
    this.messages = [];
    this.summary = "";
    return Promise.resolve();
  }

  async getStats(): Promise<MemoryStats> {
    const allMessages = await this.getMessages();
    return {
      totalMessages: allMessages.length,
      estimatedTokens: this.estimateTokens(allMessages),
      type: "summary",
    };
  }

  private summarizeOldMessages(): Promise<void> {
    // Take first half of messages for summarization
    const toSummarize = this.messages.slice(0, Math.floor(this.messages.length / 2));
    const remaining = this.messages.slice(Math.floor(this.messages.length / 2));

    // Simple summarization (in production, use LLM)
    const topics = toSummarize
      .filter((m) => m.role === "user")
      .map((m) => getTextFromParts(m.parts).substring(0, 50))
      .join("; ");

    this.summary = `Discussed: ${topics}`;
    this.messages = remaining;
    return Promise.resolve();
  }

  private estimateTokens(messages: Message[]): number {
    const totalChars = messages.reduce((sum, msg) => sum + getTextFromParts(msg.parts).length, 0) +
      this.summary.length;
    return Math.ceil(totalChars / 4);
  }
}

/**
 * Create memory instance based on config
 */
export function createMemory(config: MemoryConfig): Memory {
  switch (config.type) {
    case "conversation":
      return new ConversationMemory(config);

    case "buffer":
      return new BufferMemory(config);

    case "summary":
      return new SummaryMemory(config);

    default:
      return new ConversationMemory(config);
  }
}

/**
 * Memory persistence interface (for future implementation)
 */
export interface MemoryPersistence {
  save(agentId: string, messages: Message[]): Promise<void>;
  load(agentId: string): Promise<Message[]>;
  clear(agentId: string): Promise<void>;
}

// Re-export Redis memory for convenience
export {
  createRedisMemory,
  type RedisClient,
  RedisMemory,
  type RedisMemoryConfig,
} from "./memory-redis.ts";
